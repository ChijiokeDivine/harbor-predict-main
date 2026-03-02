// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IReceiver {
    function onReport(bytes10 workflowName, bytes calldata report) external;
}

contract PredictionMarket is IReceiver, ReentrancyGuard, Ownable {

    address public immutable forwarder;

    struct Market {
        uint256 id;
        uint256 startTime;
        uint256 endTime;
        uint256 minBet;
        uint256 maxBet;
        uint256 yesPool;
        uint256 noPool;
        address creator;
        string question;
        bool resolved;
        bool outcome;
        bool exists;
        bool canceled;
        uint256 totalClaimed;
    }

    struct Bet {
        uint256 amount;
        bool claimed;
        bool side;
    }

    // ── Used internally by batchClaimFor to avoid stack-too-deep ─────────────
    struct BatchState {
        uint256 totalPool;
        uint256 winningPool;
        uint256 batchFees;
        uint256 batchClaimed;
    }

    uint256 private marketIdCounter;
    uint256 public constant PLATFORM_FEE_BPS = 150;
    uint256 public totalCollectedFees;
    uint256 public platformLiquidityReserve;
    uint256 public constant MARKET_LIQUIDITY = 0.01 ether;
    uint256 public lifetimeFeesCollected;
    uint256 public lifetimeFeesWithdrawn;
    uint256 public constant MAX_BATCH_SIZE = 100;
    uint256 public constant RESOLUTION_BUFFER = 5 minutes;

    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(address => Bet)) public bets;
    mapping(uint256 => mapping(address => bool)) public hasBet;

    event MarketCreated(uint256 indexed marketId, string question, uint256 startTime, uint256 endTime, uint256 minBet, uint256 maxBet, address indexed creator);
    event BetPlaced(uint256 indexed marketId, address indexed user, uint256 amount, bool side);
    event MarketResolved(uint256 indexed marketId, bool outcome);
    event RewardClaimed(uint256 indexed marketId, address indexed user, uint256 amount);
    event RewardClaimedFor(uint256 indexed marketId, address indexed user);
    event PlatformFeesWithdrawn(uint256 amount);
    event LiquidityReserveFunded(uint256 amount);
    event LiquidityReserveWithdrawn(uint256 amount);
    event MarketCanceled(uint256 indexed marketId, uint256 refundedLiquidity);

    modifier marketExists(uint256 marketId) {
        require(markets[marketId].exists, "Market does not exist");
        _;
    }

    modifier marketOpen(uint256 marketId) {
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(!market.resolved, "Market is resolved");
        require(block.timestamp < market.startTime, "Market betting phase has ended");
        _;
    }

    modifier marketEnded(uint256 marketId) {
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(block.timestamp >= market.endTime, "Market has not ended");
        _;
    }

    modifier marketResolved(uint256 marketId) {
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(market.resolved, "Market is not resolved");
        _;
    }

    constructor(address _forwarder) Ownable() {
        require(_forwarder != address(0), "Invalid forwarder");
        forwarder = _forwarder;
    }

    /* ================= CRE ENTRY POINT ================= */

    function onReport(bytes10 /* workflowName */, bytes calldata report) external override {
        require(msg.sender == forwarder, "Only forwarder");
        (uint256 marketId, bool outcome) = abi.decode(report, (uint256, bool));
        _resolveMarket(marketId, outcome);
    }

    /* ================= INTERNAL RESOLUTION ================= */

    function _resolveMarket(uint256 marketId, bool outcome) internal {
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(!market.resolved, "Already resolved");
        require(
            block.timestamp >= market.endTime + RESOLUTION_BUFFER,
            "Resolution buffer active"
        );
        market.resolved = true;
        market.outcome = outcome;
        emit MarketResolved(marketId, outcome);
    }

    /* ================= OWNER MANUAL OVERRIDE ================= */

    function resolveMarket(uint256 marketId, bool outcome) external onlyOwner marketEnded(marketId) {
        _resolveMarket(marketId, outcome);
    }

    /* ================= INTERNAL CLAIM LOGIC ================= */

    function _claim(uint256 marketId, address user) internal {
        Bet storage userBet = bets[marketId][user];
        Market storage market = markets[marketId];

        require(hasBet[marketId][user], "No bet found");
        require(!userBet.claimed, "Already claimed");
        require(userBet.side == market.outcome, "Not winning side");
        require(!market.canceled, "Market canceled");

        uint256 totalPool = market.yesPool + market.noPool;
        uint256 winningPool = market.outcome ? market.yesPool : market.noPool;

        if (winningPool == 0) {
            uint256 refund = userBet.amount;
            userBet.claimed = true;
            (bool success, ) = payable(user).call{value: refund}("");
            require(success, "Refund failed");
            market.totalClaimed += refund;
            emit RewardClaimed(marketId, user, refund);
            return;
        }

        uint256 reward  = (userBet.amount * totalPool) / winningPool;
        uint256 fee     = (reward * PLATFORM_FEE_BPS) / 10000;
        uint256 payout  = reward - fee;

        totalCollectedFees      += fee;
        lifetimeFeesCollected   += fee;
        userBet.claimed = true;

        (bool success2, ) = payable(user).call{value: payout}("");
        require(success2, "Transfer failed");
        market.totalClaimed += payout;

        emit RewardClaimed(marketId, user, payout);
    }

    /* ================= BATCH CLAIM INTERNAL HELPERS ================= */

    /**
     * @dev Process a single user in a batch claim.
     *      Extracted into its own function to eliminate stack-too-deep in batchClaimFor.
     * @return fee     Platform fee taken (0 if skipped or refund path)
     * @return claimed Amount paid out to the user (0 if skipped)
     */
    function _batchProcessUser(
        uint256 marketId,
        address user,
        BatchState memory state
    ) internal returns (uint256 fee, uint256 claimed) {
        Bet storage userBet = bets[marketId][user];

        // Skip if no bet, already claimed, or zero amount
        if (!hasBet[marketId][user] || userBet.claimed || userBet.amount == 0) {
            return (0, 0);
        }

        // ── Zero winning pool: full refund ────────────────────────────────
        if (state.winningPool == 0) {
            uint256 refund = userBet.amount;
            userBet.claimed = true;
            (bool ok, ) = payable(user).call{value: refund}("");
            if (ok) {
                emit RewardClaimed(marketId, user, refund);
                return (0, refund);
            } else {
                userBet.claimed = false;
                return (0, 0);
            }
        }

        // ── Normal reward: only pay winners ──────────────────────────────
        Market storage market = markets[marketId];
        if (userBet.side != market.outcome) {
            return (0, 0);
        }

        uint256 reward = (userBet.amount * state.totalPool) / state.winningPool;
        uint256 f      = (reward * PLATFORM_FEE_BPS) / 10_000;
        uint256 payout = reward - f;

        userBet.claimed = true;
        (bool ok2, ) = payable(user).call{value: payout}("");
        if (ok2) {
            emit RewardClaimed(marketId, user, payout);
            return (f, payout);
        } else {
            userBet.claimed = false;
            return (0, 0);
        }
    }

    /* ================= MARKET MANAGEMENT ================= */

    function fundLiquidityReserve() external payable onlyOwner {
        require(msg.value > 0, "Must send ETH to fund reserve");
        platformLiquidityReserve += msg.value;
        emit LiquidityReserveFunded(msg.value);
    }

    function createMarket(
        string calldata question,
        uint256 startTime,
        uint256 endTime,
        uint256 minBet,
        uint256 maxBet
    ) external {
        require(startTime > block.timestamp, "Start time must be in the future");
        require(endTime > startTime, "End time must be after start time");
        require(minBet > 0, "Min bet must be greater than 0");
        require(maxBet > minBet, "Max bet must be greater than min bet");
        require(bytes(question).length > 0, "Question cannot be empty");
        require(platformLiquidityReserve >= MARKET_LIQUIDITY, "Insufficient platform liquidity");

        marketIdCounter++;
        uint256 initialLiquidity = MARKET_LIQUIDITY / 2;
        platformLiquidityReserve -= MARKET_LIQUIDITY;

        markets[marketIdCounter] = Market({
            id: marketIdCounter,
            startTime: startTime,
            endTime: endTime,
            minBet: minBet,
            maxBet: maxBet,
            yesPool: initialLiquidity,
            noPool: initialLiquidity,
            creator: msg.sender,
            question: question,
            resolved: false,
            outcome: false,
            exists: true,
            canceled: false,
            totalClaimed: 0
        });

        emit MarketCreated(marketIdCounter, question, startTime, endTime, minBet, maxBet, msg.sender);
    }

    function placeBet(uint256 marketId, bool side) external payable marketOpen(marketId) {
        require(!hasBet[marketId][msg.sender], "Already bet on this market");
        Market storage market = markets[marketId];
        require(msg.value >= market.minBet, "Bet amount below minimum");
        require(msg.value <= market.maxBet, "Bet amount above maximum");

        uint256 fee           = (msg.value * PLATFORM_FEE_BPS) / 10000;
        uint256 amountAfterFee = msg.value - fee;
        totalCollectedFees    += fee;
        lifetimeFeesCollected += fee;

        bets[marketId][msg.sender] = Bet({
            amount: amountAfterFee,
            side: side,
            claimed: false
        });
        hasBet[marketId][msg.sender] = true;

        if (side) {
            market.yesPool += amountAfterFee;
        } else {
            market.noPool += amountAfterFee;
        }

        emit BetPlaced(marketId, msg.sender, amountAfterFee, side);
    }

    function claimReward(uint256 marketId) external nonReentrant marketResolved(marketId) {
        _claim(marketId, msg.sender);
    }

    function claimFor(uint256 marketId, address user) external nonReentrant marketResolved(marketId) {
        _claim(marketId, user);
        emit RewardClaimedFor(marketId, user);
    }

    function batchClaimFor(
        uint256 marketId,
        address[] calldata users
    )
        external
        nonReentrant
        marketResolved(marketId)
    {
        require(users.length <= MAX_BATCH_SIZE, "Batch too large");

        Market storage market = markets[marketId];
        require(!market.canceled, "Market canceled");

        // Build the shared state struct once — avoids stack-too-deep in the loop
        BatchState memory state = BatchState({
            totalPool   : market.yesPool + market.noPool,
            winningPool : market.outcome ? market.yesPool : market.noPool,
            batchFees   : 0,
            batchClaimed: 0
        });

        for (uint256 i = 0; i < users.length;) {
            (uint256 fee, uint256 paid) = _batchProcessUser(marketId, users[i], state);
            state.batchFees    += fee;
            state.batchClaimed += paid;
            unchecked { ++i; }
        }

        // Single storage write per field — gas efficient
        if (state.batchFees > 0) {
            totalCollectedFees    += state.batchFees;
            lifetimeFeesCollected += state.batchFees;
        }
        if (state.batchClaimed > 0) {
            market.totalClaimed += state.batchClaimed;
        }
    }

    function claimRefund(uint256 marketId) external nonReentrant {
        Market storage market = markets[marketId];
        require(market.exists, "Market does not exist");
        require(market.canceled, "Market not canceled");

        Bet storage userBet = bets[marketId][msg.sender];
        require(hasBet[marketId][msg.sender], "No bet found");
        require(!userBet.claimed, "Already claimed");

        uint256 refundAmount = userBet.amount;
        require(refundAmount > 0, "Nothing to refund");

        userBet.claimed = true;
        (bool success, ) = payable(msg.sender).call{value: refundAmount}("");
        require(success, "Refund failed");

        emit RewardClaimed(marketId, msg.sender, refundAmount);
    }

    /* ================= ADMIN ================= */

    function sweepMarketDust(uint256 marketId) external onlyOwner {
        Market storage market = markets[marketId];
        require(market.resolved, "Not resolved");
        require(!market.canceled, "Canceled market");

        uint256 totalPool   = market.yesPool + market.noPool;
        uint256 winningPool = market.outcome ? market.yesPool : market.noPool;
        require(winningPool > 0, "No winning pool");

        uint256 expectedTotalPayout = (totalPool * (10000 - PLATFORM_FEE_BPS)) / 10000;
        uint256 dust = expectedTotalPayout - market.totalClaimed;
        require(dust > 0, "No dust");

        market.totalClaimed += dust;
        (bool success, ) = payable(owner()).call{value: dust}("");
        require(success, "Dust transfer failed");
    }

    function withdrawPlatformFees() external onlyOwner {
        uint256 amount = totalCollectedFees;
        require(amount > 0, "No fees to withdraw");
        totalCollectedFees = 0;
        lifetimeFeesWithdrawn += amount;
        (bool success, ) = payable(owner()).call{value: amount}("");
        require(success, "Transfer failed");
        emit PlatformFeesWithdrawn(amount);
    }

    function withdrawLiquidityReserve(uint256 amount) external onlyOwner {
        require(amount > 0, "Amount must be greater than 0");
        require(amount <= platformLiquidityReserve, "Insufficient reserve balance");
        platformLiquidityReserve -= amount;
        (bool success, ) = payable(owner()).call{value: amount}("");
        require(success, "Withdrawal failed");
        emit LiquidityReserveWithdrawn(amount);
    }

    function cancelMarket(uint256 marketId) external onlyOwner marketExists(marketId) {
        Market storage market = markets[marketId];
        require(!market.resolved, "Cannot cancel resolved market");

        market.resolved = true;
        market.canceled = true;
        platformLiquidityReserve += MARKET_LIQUIDITY;

        emit MarketCanceled(marketId, MARKET_LIQUIDITY);
    }

    function emergencyWithdrawFees() external onlyOwner {
        uint256 amount = totalCollectedFees;
        require(amount > 0, "No fees available");
        totalCollectedFees = 0;
        lifetimeFeesWithdrawn += amount;
        (bool success, ) = payable(owner()).call{value: amount}("");
        require(success, "Transfer failed");
    }

    function _checkSolvency() internal view {
        require(
            address(this).balance >= platformLiquidityReserve + totalCollectedFees,
            "Protocol insolvent"
        );
    }

    /* ================= VIEWS ================= */

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return markets[marketId];
    }

    function getUserBet(uint256 marketId, address user) external view returns (Bet memory) {
        return bets[marketId][user];
    }

    function hasUserBet(uint256 marketId, address user) external view returns (bool) {
        return hasBet[marketId][user];
    }

    function getMarketCount() external view returns (uint256) {
        return marketIdCounter;
    }

    function getWithdrawableFees() external view returns (uint256) {
        return totalCollectedFees;
    }

    function getPlatformStats() external view returns (
        uint256 lifetimeFees,
        uint256 withdrawnFees,
        uint256 withdrawableFees,
        uint256 liquidityReserve,
        uint256 contractBalance
    ) {
        return (
            lifetimeFeesCollected,
            lifetimeFeesWithdrawn,
            totalCollectedFees,
            platformLiquidityReserve,
            address(this).balance
        );
    }

    function getPlatformProfit() external view returns (uint256) {
        return lifetimeFeesCollected - lifetimeFeesWithdrawn;
    }

    function getOdds(uint256 marketId) external view returns (uint256 yesOdds, uint256 noOdds) {
        Market storage market = markets[marketId];
        uint256 totalPool = market.yesPool + market.noPool;
        if (totalPool == 0) return (20000, 20000);

        uint256 yesProbability  = (market.yesPool * 10000) / totalPool;
        uint256 noProbability   = (market.noPool  * 10000) / totalPool;
        uint256 feeAdjustment   = 10000 - PLATFORM_FEE_BPS;

        yesOdds = (10000 * 10000 * feeAdjustment) / (yesProbability * 10000);
        noOdds  = (10000 * 10000 * feeAdjustment) / (noProbability  * 10000);
    }

    function getMarketVolume(uint256 marketId) external view marketExists(marketId) returns (uint256) {
        Market storage market = markets[marketId];
        uint256 initialLiquidityPerPool = MARKET_LIQUIDITY / 2;
        uint256 yesVolume = market.yesPool >= initialLiquidityPerPool ? market.yesPool - initialLiquidityPerPool : 0;
        uint256 noVolume  = market.noPool  >= initialLiquidityPerPool ? market.noPool  - initialLiquidityPerPool : 0;
        return yesVolume + noVolume;
    }

    receive() external payable {}
}
