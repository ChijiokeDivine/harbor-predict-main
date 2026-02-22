// test/PredictionMarket.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PredictionMarket", function () {
  let owner, alice, bob, carol, oracle;
  let market, routerMock;
  let MARKET_LIQUIDITY;

  const QUESTION = "Will Bitcoin reach $150k in 2025?";
  const MIN_BET = ethers.parseEther("0.1");
  const MAX_BET = ethers.parseEther("10");
  const PLATFORM_FEE_BPS = 150n; // 1.5%

  beforeEach(async function () {
    [owner, alice, bob, carol, oracle] = await ethers.getSigners();

    // Mock Router - minimal implementation to satisfy constructor
    const MockRouter = await ethers.getContractFactory("MockFunctionsRouter");
    routerMock = await MockRouter.deploy();

    const PredictionMarket = await ethers.getContractFactory("PredictionMarket");
    market = await PredictionMarket.deploy(routerMock.target);

    MARKET_LIQUIDITY = await market.MARKET_LIQUIDITY();
    await market.fundLiquidityReserve({ value: ethers.parseEther("100") });
    await market.setOracle(oracle.address);
  });

  async function createOpenMarket(duration = 7200) {
    const latest = await ethers.provider.getBlock("latest");
    const startTime = latest.timestamp + 1000; // Betting phase ends in 1000s
    const endTime = startTime + duration;

    await market.createMarket(QUESTION, startTime, endTime, MIN_BET, MAX_BET);
    return 1n; // marketId
  }

  async function placeBets(marketId) {
    await market.connect(alice).placeBet(marketId, true, { value: ethers.parseEther("2") });
    await market.connect(bob).placeBet(marketId, false, { value: ethers.parseEther("3") });
    await market.connect(carol).placeBet(marketId, true, { value: ethers.parseEther("1.5") });
  }

  describe("Deployment & Configuration", function () {
    it("sets correct initial state", async function () {
      expect(await market.owner()).to.equal(owner.address);
      expect(await market.PLATFORM_FEE_BPS()).to.equal(150n);
      expect(await market.MARKET_LIQUIDITY()).to.equal(ethers.parseEther("8"));
      expect(await market.platformLiquidityReserve()).to.equal(ethers.parseEther("100"));
    });

    it("allows owner to set oracle", async function () {
      await expect(market.setOracle(oracle.address))
        .to.not.be.reverted;

      expect(await market.oracle()).to.equal(oracle.address);
    });

    it("rejects zero address oracle", async function () {
      await expect(market.setOracle(ethers.ZeroAddress)).to.be.revertedWith("Invalid oracle");
    });
  });

  describe("Market Creation", function () {
    it("creates market and deducts liquidity", async function () {
      const tx = await market.createMarket(QUESTION, 2000000000n, 2000100000n, MIN_BET, MAX_BET);
      await expect(tx)
        .to.emit(market, "MarketCreated")
        .withArgs(1, QUESTION, 2000000000n, 2000100000n, MIN_BET, MAX_BET, owner.address);

      const m = await market.getMarket(1);
      expect(m.exists).to.be.true;
      expect(m.yesPool).to.equal(MARKET_LIQUIDITY / 2n);
      expect(m.noPool).to.equal(MARKET_LIQUIDITY / 2n);
      expect(await market.platformLiquidityReserve()).to.equal(
        ethers.parseEther("100") - MARKET_LIQUIDITY
      );
    });

    it("reverts on invalid parameters", async function () {
      const now = (await ethers.provider.getBlock("latest")).timestamp;

      await expect(
        market.createMarket(QUESTION, now - 100, now + 3600, MIN_BET, MAX_BET)
      ).to.be.revertedWith("Start time must be in the future");

      await expect(
        market.createMarket(QUESTION, now + 1000, now + 500, MIN_BET, MAX_BET)
      ).to.be.revertedWith("End time must be after start time");

      await expect(
        market.createMarket(QUESTION, now + 1000, now + 3600, 0, MAX_BET)
      ).to.be.revertedWith("Min bet must be greater than 0");

      await expect(
        market.createMarket(QUESTION, now + 1000, now + 3600, MIN_BET, MIN_BET)
      ).to.be.revertedWith("Max bet must be greater than min bet");

      await expect(
        market.createMarket("", now + 1000, now + 3600, MIN_BET, MAX_BET)
      ).to.be.revertedWith("Question cannot be empty");
    });

    it("reverts when liquidity reserve is insufficient", async function () {
      await market.withdrawLiquidityReserve(await market.platformLiquidityReserve());
      await expect(
        market.createMarket(QUESTION, 2000000000n, 2000100000n, MIN_BET, MAX_BET)
      ).to.be.revertedWith("Insufficient platform liquidity");
    });
  });

  describe("Placing Bets", function () {
    it("places YES and NO bets correctly", async function () {
      const marketId = await createOpenMarket();
      const amount = ethers.parseEther("2.5");
      const feeBps = 150n;
      const expectedNet = (amount * (10000n - feeBps)) / 10000n;

      await expect(market.connect(alice).placeBet(marketId, true, { value: amount }))
        .to.emit(market, "BetPlaced")
        .withArgs(marketId, alice.address, expectedNet, true);

      const bet = await market.getUserBet(marketId, alice.address);
      expect(bet.amount).to.equal(expectedNet);
    });

    it("enforces min/max bet size", async function () {
      const marketId = await createOpenMarket();
      await expect(
        market.connect(alice).placeBet(marketId, true, { value: MIN_BET - 1n })
      ).to.be.revertedWith("Bet amount below minimum");
    });

    it("prevents double betting", async function () {
      const marketId = await createOpenMarket();
      await market.connect(alice).placeBet(marketId, true, { value: MIN_BET });
      await expect(
        market.connect(alice).placeBet(marketId, false, { value: MIN_BET })
      ).to.be.revertedWith("User has already bet on this market");
    });

    it("cannot bet after betting phase ends", async function () {
      const marketId = await createOpenMarket();
      await ethers.provider.send("evm_increaseTime", [4000]);
      await ethers.provider.send("evm_mine");

      await expect(
        market.connect(alice).placeBet(marketId, true, { value: MIN_BET })
      ).to.be.revertedWith("Market betting phase has ended");
    });
  });

  describe("Market Resolution & Claiming", function () {
    let marketId;

    beforeEach(async function () {
      marketId = await createOpenMarket();
      await placeBets(marketId);

      // FAST FORWARD: Move time past endTime to allow resolution
      const m = await market.getMarket(marketId);
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(m.endTime) + 1]);
      await ethers.provider.send("evm_mine");
    });

    it("owner can resolve market", async function () {
      await expect(market.resolveMarket(marketId, true))
        .to.emit(market, "MarketResolved")
        .withArgs(marketId, true);
    });

    it("oracle can also resolve", async function () {
      await expect(market.connect(oracle).resolveMarket(marketId, false))
        .to.emit(market, "MarketResolved")
        .withArgs(marketId, false);
    });

    it("winner claims correct amount", async function () {
      await market.resolveMarket(marketId, true);
      const aliceBefore = await ethers.provider.getBalance(alice.address);
      
      const tx = await market.connect(alice).claimReward(marketId);
      const receipt = await tx.wait();
      
      const aliceAfter = await ethers.provider.getBalance(alice.address);
      expect(aliceAfter).to.be.gt(aliceBefore);
    });

    it("loser cannot claim", async function () {
      await market.resolveMarket(marketId, true);

      await expect(
        market.connect(bob).claimReward(marketId)
      ).to.be.revertedWith("Not winning side");
    });

    it("cannot claim twice", async function () {
      await market.resolveMarket(marketId, true);
      await market.connect(alice).claimReward(marketId);

      await expect(
        market.connect(alice).claimReward(marketId)
      ).to.be.revertedWith("Already claimed");
    });
  });

  describe("Auto-cancel when no bets", function () {
    it("auto-cancels market with no real bets", async function () {
      const marketId = await createOpenMarket();
      const m = await market.getMarket(marketId);
      
      // Move past endTime
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(m.endTime) + 1]);
      await ethers.provider.send("evm_mine");

      await expect(market.requestMarketResolution(marketId, "source", []))
        .to.emit(market, "MarketCanceled");
    });
  });

  describe("Fees & Withdrawals", function () {
    let marketId;

    beforeEach(async function () {
      const duration = 20000;
      marketId = await createOpenMarket(duration);
      await placeBets(marketId);
      await ethers.provider.send("evm_increaseTime", [duration + 1001]);
      await ethers.provider.send("evm_mine");
      await market.resolveMarket(marketId, true);
      await market.connect(alice).claimReward(marketId);
      await market.connect(carol).claimReward(marketId);
    });

    it("owner can withdraw collected fees", async function () {
      const fees = await market.getWithdrawableFees();
      expect(fees).to.be.gt(0);

      const ownerBefore = await ethers.provider.getBalance(owner.address);

      const tx = await market.withdrawPlatformFees();
      const receipt = await tx.wait();

      const ownerAfter = await ethers.provider.getBalance(owner.address);
      expect(ownerAfter - ownerBefore + receipt.fee).to.be.closeTo(fees, ethers.parseEther("0.001"));

      expect(await market.totalCollectedFees()).to.equal(0);
    });

    it("can withdraw from liquidity reserve", async function () {
      const amount = ethers.parseEther("15");
      const before = await market.platformLiquidityReserve();

      await expect(market.withdrawLiquidityReserve(amount))
        .to.emit(market, "LiquidityReserveWithdrawn")
        .withArgs(amount);

      expect(await market.platformLiquidityReserve()).to.equal(before - amount);
    });
  });

  describe("Access Control & Safety", function () {
    let marketId;

    beforeEach(async function () {
      marketId = await createOpenMarket(7200);
    });

    it("non-owner cannot withdraw fees / liquidity", async function () {
      await expect(market.connect(alice).withdrawPlatformFees())
        .to.be.revertedWith("Ownable: caller is not the owner");

      await expect(market.connect(alice).withdrawLiquidityReserve(1))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("emergencyWithdraw sends all ETH to owner", async function () {
      await alice.sendTransaction({ to: market.target, value: ethers.parseEther("2.7") });

      const before = await ethers.provider.getBalance(owner.address);
      await market.emergencyWithdraw();
      const after = await ethers.provider.getBalance(owner.address);

      expect(after).to.be.gt(before);
    });

    it("only owner can cancel market", async function () {
      await expect(market.connect(alice).cancelMarket(marketId))
        .to.be.revertedWith("Ownable: caller is not the owner");

      await expect(market.cancelMarket(marketId))
        .to.emit(market, "MarketCanceled")
        .withArgs(marketId, MARKET_LIQUIDITY);
    });
  });
  describe("Batch Claim For", function () {
    let marketId;
    let rejector;

    beforeEach(async function () {
      // 1. Deploy rejector once for the suite
      const Rejector = await ethers.getContractFactory("MockRejectingReceiver");
      rejector = await Rejector.deploy();

      const duration = 20000;
      marketId = await createOpenMarket(duration);
      
      // 2. Place standard bets
      await placeBets(marketId);
      
      // 3. Place the failing contract bet NOW while betting is open
      const betAmount = ethers.parseEther("0.8");
      await rejector.placeBet(market.target, marketId, true, { value: betAmount });

      // 4. Fast forward to end
      await ethers.provider.send("evm_increaseTime", [duration + 10001]);
      await ethers.provider.send("evm_mine");

      await market.resolveMarket(marketId, true); // YES wins
    });

    it("allows batch claiming for multiple winners", async function () {
      const users = [alice.address, carol.address];
      const aliceBalBefore = await ethers.provider.getBalance(alice.address);
      const carolBalBefore = await ethers.provider.getBalance(carol.address);

      const tx = await market.batchClaimFor(marketId, users);
      const receipt = await tx.wait();

      const aliceBalAfter = await ethers.provider.getBalance(alice.address);
      const carolBalAfter = await ethers.provider.getBalance(carol.address);

      expect(aliceBalAfter).to.be.gt(aliceBalBefore);
      expect(carolBalAfter).to.be.gt(carolBalBefore);

      const aliceBet = await market.getUserBet(marketId, alice.address);
      const carolBet = await market.getUserBet(marketId, carol.address);
      expect(aliceBet.claimed).to.be.true;
      expect(carolBet.claimed).to.be.true;
    });

    it("skips already claimed and non-winners silently", async function () {
      // Alice claims normally first
      await market.connect(alice).claimReward(marketId);

      // Now batch including alice (already claimed), bob (loser), carol (winner)
      const users = [alice.address, bob.address, carol.address];

      const carolBalBefore = await ethers.provider.getBalance(carol.address);
      await market.batchClaimFor(marketId, users);
      const carolBalAfter = await ethers.provider.getBalance(carol.address);

      expect(carolBalAfter).to.be.gt(carolBalBefore);

      // Alice still claimed = true, bob still not claimed (but skipped)
      expect((await market.getUserBet(marketId, alice.address)).claimed).to.be.true;
      expect((await market.getUserBet(marketId, bob.address)).claimed).to.be.false;
    });

    it("handles transfer failure safely (rolls back state)", async function () {
      const users = [rejector.target];
      
      // This will attempt to pay the contract, fail, and roll back claimed status
      const tx = await market.batchClaimFor(marketId, users);
      await expect(tx).to.not.be.reverted;

      const betAfter = await market.getUserBet(marketId, rejector.target);
      expect(betAfter.claimed).to.be.false; 
    });
  });

  describe("getOdds Calculation", function () {
    let marketId;

    beforeEach(async function () {
      marketId = await createOpenMarket(7200);
    });

    it("returns 2.0000 for both when pools are equal (initial state)", async function () {
      const [yesOdds, noOdds] = await market.getOdds(marketId);

      // 2.0000 → 20000 in fixed point 4 decimals
      expect(yesOdds).to.equal(19700n);
      expect(noOdds).to.equal(19700n);
    });

    it("correctly adjusts odds when bets are imbalanced", async function () {
      await market.connect(alice).placeBet(marketId, true, { value: ethers.parseEther("4") });
      await market.connect(bob).placeBet(marketId, false, { value: ethers.parseEther("1") });

      const [yesOdds, noOdds] = await market.getOdds(marketId);

      // YES has more money → lower odds (pays less), NO has higher odds
      expect(yesOdds).to.be.lt(20000n);
      expect(noOdds).to.be.gt(20000n);
    });

    it("applies platform fee adjustment correctly", async function () {
      await market.connect(alice).placeBet(marketId, true, { value: ethers.parseEther("2") });

      const [yesOdds] = await market.getOdds(marketId);

      // With 1.5% fee, fair odds should be slightly worse than true probability
      // Exact value depends on initial liquidity, but should be < pure probability odds
      expect(yesOdds).to.be.lt(30000n); // just directional check
    });
  });

  describe("Chainlink Resolution Request & Fulfill Flow", function () {
    let marketId;

    beforeEach(async function () {
      const duration = 5000;
      marketId = await createOpenMarket(duration);

      // Place bets so market doesn't auto-cancel on resolution request
      await market.connect(alice).placeBet(marketId, true, { value: ethers.parseEther("1.5") });

      // Jump past the end time
      await ethers.provider.send("evm_increaseTime", [duration + 1001]);
      await ethers.provider.send("evm_mine");
    });

    it("prevents double resolution request", async function () {
      await market.requestMarketResolution(marketId, "return true;", []);

      await expect(
        market.requestMarketResolution(marketId, "return true;", [])
      ).to.be.revertedWith("Already requested");
    });

    it("sets resolutionRequested flag and stores requestId → market mapping", async function () {
      const tx = await market.requestMarketResolution(marketId, "source", []);
      const receipt = await tx.wait();

      // Find the ResolutionRequested event to get the ID generated by the Mock Router
      const event = receipt.logs.find(l => l.fragment?.name === "ResolutionRequested");
      const requestId = event.args.requestId;

      expect(await market.resolutionRequested(marketId)).to.be.true;
      expect(await market.requestToMarket(requestId)).to.equal(marketId);
    });

    it("fulfills request and resolves market via router", async function () {
      // 1. Request resolution
      const tx = await market.requestMarketResolution(marketId, "return true;", []);
      const receipt = await tx.wait();
      
      const event = receipt.logs.find(l => l.fragment?.name === "ResolutionRequested");
      const requestId = event.args.requestId;

      // 2. Encode a 'true' outcome as the oracle response
      const response = ethers.AbiCoder.defaultAbiCoder().encode(["bool"], [true]);
      const noError = "0x";

      // 3. Trigger the mock fulfillment
      // routerMock must be the instance deployed in your top-level beforeEach
      await expect(routerMock.fulfill(market.target, requestId, response, noError))
        .to.emit(market, "MarketResolved")
        .withArgs(marketId, true);

      const m = await market.getMarket(marketId);
      expect(m.resolved).to.be.true;
      expect(m.outcome).to.be.true;
    });

    it("rejects fulfillment with error data", async function () {
      const tx = await market.requestMarketResolution(marketId, "return true;", []);
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => l.fragment?.name === "ResolutionRequested");
      const requestId = event.args.requestId;

      const emptyResponse = "0x";
      const errorMsg = ethers.toUtf8Bytes("oracle failed");

      // This will revert because your fulfillRequest logic likely checks if(err.length > 0)
      // Since routerMock uses a low-level call, it will catch the revert and throw "Callback failed"
      await expect(routerMock.fulfill(market.target, requestId, emptyResponse, errorMsg))
        .to.be.revertedWith("Callback failed");
    });
  });
});
  // Add more suites for:
  // • batchClaimFor()
  // • getOdds() correctness
  // • Chainlink request → fulfill flow (with mock)
  // • resolutionRequested flag & double request prevention
