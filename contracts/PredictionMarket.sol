// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import {FunctionsClient} from "@chainlink/contracts/src/v0.8/functions/v1_0_0/FunctionsClient.sol";
import {FunctionsRequest} from "@chainlink/contracts/src/v0.8/functions/v1_0_0/libraries/FunctionsRequest.sol";

contract PredictionMarket is FunctionsClient, ReentrancyGuard, Ownable {
    using FunctionsRequest for FunctionsRequest.Request;


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
    }

    struct Bet {
        uint256 amount;
        bool claimed;
        bool side;
    }

    uint256 private marketIdCounter;
    uint256 public constant PLATFORM_FEE_BPS = 150; // 1.5% = 150 basis points
    uint256 public totalCollectedFees;
    uint256 public platformLiquidityReserve;
    uint256 public constant MARKET_LIQUIDITY = 8 ether;
    uint256 public lifetimeFeesCollected;
    uint256 public lifetimeFeesWithdrawn;

    address public oracle;





    /* ================= CHAINLINK CONFIG ================= */

    bytes32 public donId;
    uint64 public subscriptionId;
    uint32 public gasLimit = 300000;

    mapping(bytes32 => uint256) public requestToMarket;
    mapping(uint256 => bool) public resolutionRequested;

    event ResolutionRequested(uint256 indexed marketId, bytes32 requestId);
    event OracleFulfilled(bytes32 indexed requestId, bool outcome);

    constructor(address router) 
        FunctionsClient(router) 
    {}


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

    modifier onlyOracleOrOwner() {
        require(
            msg.sender == oracle || msg.sender == owner(),
            "Not authorized"
        );
        _;
    }


     /* ================= INTERNAL CLAIM LOGIC ================= */

    function _claim(uint256 marketId, address user) internal {
        Bet storage userBet = bets[marketId][user];
        Market storage market = markets[marketId];

        require(hasBet[marketId][user], "No bet found");
        require(!userBet.claimed, "Already claimed");
        require(userBet.side == market.outcome, "Not winning side");

        uint256 totalPool = market.yesPool + market.noPool;
        uint256 winningPool = market.outcome ? market.yesPool : market.noPool;
        require(winningPool > 0, "Winning pool empty");

        uint256 reward = (userBet.amount * totalPool) / winningPool;
        uint256 fee = (reward * PLATFORM_FEE_BPS) / 10000;
        uint256 payout = reward - fee;

        totalCollectedFees += fee;
        lifetimeFeesCollected += fee;
        userBet.claimed = true;

        (bool success, ) = payable(user).call{value: payout}("");
        require(success, "Transfer failed");

        emit RewardClaimed(marketId, user, payout);
    }
    
    // Add function to fund the liquidity reserve
    function fundLiquidityReserve() external payable onlyOwner {
        require(msg.value > 0, "Must send MON to fund reserve");
        platformLiquidityReserve += msg.value;
        emit LiquidityReserveFunded(msg.value);
    }

    function createMarket(string calldata question, uint256 startTime, uint256 endTime, uint256 minBet, uint256 maxBet) external {
        require(startTime > block.timestamp, "Start time must be in the future");
        require(endTime > startTime, "End time must be after start time");
        require(minBet > 0, "Min bet must be greater than 0");
        require(maxBet > minBet, "Max bet must be greater than min bet");
        require(bytes(question).length > 0, "Question cannot be empty");
        require(platformLiquidityReserve >= MARKET_LIQUIDITY, "Insufficient platform liquidity");

        marketIdCounter++;
        uint256 initialLiquidity = MARKET_LIQUIDITY / 2; // 4 MON for each pool
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
            question: question, // Fixed: Include question field
            resolved: false,
            outcome: false,
            exists: true
        });

        emit MarketCreated(marketIdCounter, question, startTime, endTime, minBet, maxBet, msg.sender);
    }

    function placeBet(uint256 marketId, bool side) external payable marketOpen(marketId) {
        require(!hasBet[marketId][msg.sender], "User has already bet on this market");
        Market storage market = markets[marketId];
        require(msg.value >= market.minBet, "Bet amount below minimum");
        require(msg.value <= market.maxBet, "Bet amount above maximum");

        uint256 fee = (msg.value * PLATFORM_FEE_BPS) / 10000;
        uint256 amountAfterFee = msg.value - fee;
        totalCollectedFees += fee;
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

    function resolveMarket(uint256 marketId, bool outcome) external onlyOracleOrOwner marketEnded(marketId) {
        Market storage market = markets[marketId];
        require(!market.resolved, "Market already resolved");
        market.resolved = true;
        market.outcome = outcome;
        emit MarketResolved(marketId, outcome);
    }

    function claimReward(uint256 marketId)
        external
        nonReentrant
        marketResolved(marketId)
    {
        _claim(marketId, msg.sender);
    }


    function claimFor(uint256 marketId, address user)
        external
        nonReentrant
        marketResolved(marketId)
    {
        _claim(marketId, user);
        emit RewardClaimedFor(marketId, user);
    }

    function withdrawPlatformFees() external onlyOwner {
        uint256 amount = totalCollectedFees;
        require(amount > 0, "No fees to withdraw");
        totalCollectedFees = 0;
        lifetimeFeesWithdrawn += amount;

        (bool success, ) = payable(owner()).call{value: amount}("");
        require(success, "Platform fee transfer failed");

        emit PlatformFeesWithdrawn(amount);
    }

    // Withdraw unused liquidity from the reserve
    function withdrawLiquidityReserve(uint256 amount) external onlyOwner {
        require(amount > 0, "Amount must be greater than 0");
        require(amount <= platformLiquidityReserve, "Insufficient reserve balance");
        platformLiquidityReserve -= amount;

        (bool success, ) = payable(owner()).call{value: amount}("");
        require(success, "Reserve withdrawal failed");

        emit LiquidityReserveWithdrawn(amount);
    }
    function batchClaimFor(uint256 marketId,address[] calldata users) external nonReentrant marketResolved(marketId){
        Market storage market = markets[marketId];

        uint256 totalPool = market.yesPool + market.noPool;
        uint256 winningPool = market.outcome ? market.yesPool : market.noPool;

        // If nobody won, no claims possible
        if (winningPool == 0) return;

        for (uint256 i = 0; i < users.length; ) {
            address user = users[i];
            Bet storage userBet = bets[marketId][user];

            // Skip invalid cases (NO REVERTS)
            if (
                hasBet[marketId][user] &&
                !userBet.claimed &&
                userBet.side == market.outcome &&
                userBet.amount > 0
            ) {
                uint256 reward = (userBet.amount * totalPool) / winningPool;
                uint256 fee = (reward * PLATFORM_FEE_BPS) / 10_000;
                uint256 payout = reward - fee;

                userBet.claimed = true;
                totalCollectedFees += fee;

                // ETH send — failure safe
                (bool success, ) = payable(user).call{value: payout}("");
                if (success) {
                    emit RewardClaimed(marketId, user, payout);
                } else {
                    // rollback claim state if transfer fails
                    userBet.claimed = false;
                    totalCollectedFees -= fee;
                }
            }

            unchecked {
                ++i;
            }
        }
    }


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
    )
    {
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
        
        if (totalPool == 0) {
            return (20000, 20000); // 2.0000 in fixed-point (50% probability, fee-adjusted)
        }

        uint256 yesProbability = (market.yesPool * 10000) / totalPool;
        uint256 noProbability = (market.noPool * 10000) / totalPool;

        uint256 feeAdjustment = 10000 - PLATFORM_FEE_BPS; // 9850 for 1.5% fee
        yesOdds = (10000 * 10000 * feeAdjustment) / (yesProbability * 10000);
        noOdds = (10000 * 10000 * feeAdjustment) / (noProbability * 10000);

        return (yesOdds, noOdds);
    }

    // Get the total betting volume for a market (excluding initial liquidity)
    function getMarketVolume(uint256 marketId) external view marketExists(marketId) returns (uint256) {
        Market storage market = markets[marketId];
        uint256 initialLiquidityPerPool = MARKET_LIQUIDITY / 2; // 8 MON in wei
        uint256 yesVolume = market.yesPool >= initialLiquidityPerPool ? market.yesPool - initialLiquidityPerPool : 0;
        uint256 noVolume = market.noPool >= initialLiquidityPerPool ? market.noPool - initialLiquidityPerPool : 0;
        return yesVolume + noVolume;
    }

    function emergencyWithdraw() external onlyOwner {
        uint256 amount = address(this).balance;
        require(amount > 0, "No funds to withdraw");
        (bool success, ) = payable(owner()).call{value: amount}("");
        require(success, "Transfer failed");
    }

    function cancelMarket(uint256 marketId) external onlyOwner marketExists(marketId) {
        Market storage market = markets[marketId];
        require(!market.resolved, "Cannot cancel resolved market");

        // Refund initial liquidity to the reserve
        uint256 refundedLiquidity = market.yesPool + market.noPool;
        platformLiquidityReserve += refundedLiquidity;

        // Reset pools to prevent further betting or claims
        market.yesPool = 0;
        market.noPool = 0;
        market.resolved = true;

        emit MarketCanceled(marketId, refundedLiquidity);
    }

    function setOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "Invalid oracle");
        oracle = _oracle;
    }



    function setChainlinkConfig( bytes32 _donId, uint64 _subscriptionId, uint32 _gasLimit) external onlyOwner {
        donId = _donId;
        subscriptionId = _subscriptionId;
        gasLimit = _gasLimit;
    }



    function requestMarketResolution(uint256 marketId, string calldata source, string[] calldata args) external marketEnded(marketId){
        Market storage market = markets[marketId];
        require(!markets[marketId].resolved, "Already resolved");
        require(!resolutionRequested[marketId], "Already requested");


        uint256 initialLiquidity = MARKET_LIQUIDITY / 2;

        // --- ADD THE CHECK HERE ---
        if (market.yesPool == initialLiquidity && market.noPool == initialLiquidity) {
            // Nobody bet → auto-cancel & refund liquidity to reserve
            uint256 refundedLiquidity = market.yesPool + market.noPool;
            platformLiquidityReserve += refundedLiquidity;

            market.yesPool = 0;
            market.noPool = 0;
            market.resolved = true;           // or use a separate "canceled" flag

            emit MarketCanceled(marketId, refundedLiquidity);
            return;   // ← important: exit early
        }

        FunctionsRequest.Request memory req;
        req.initializeRequestForInlineJavaScript(source);

        if (args.length > 0) {
            req.setArgs(args);
        }

        bytes32 requestId = _sendRequest(
            req.encodeCBOR(),
            subscriptionId,
            gasLimit,
            donId
        );

        requestToMarket[requestId] = marketId;
        resolutionRequested[marketId] = true;

        emit ResolutionRequested(marketId, requestId);
    }



    function fulfillRequest(bytes32 requestId, bytes memory response, bytes memory err) internal override {

        require(err.length == 0, "Oracle error");

        uint256 marketId = requestToMarket[requestId];
        require(markets[marketId].exists, "Invalid market");

        bool outcome = abi.decode(response, (bool));

        Market storage market = markets[marketId];
        require(!market.resolved, "Already resolved");

        market.resolved = true;
        market.outcome = outcome;

        emit OracleFulfilled(requestId, outcome);
        emit MarketResolved(marketId, outcome);
    }


    receive() external payable {}
}
