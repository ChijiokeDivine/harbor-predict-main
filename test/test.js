// test/PredictionMarket.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

// ─────────────────────────────────────────────────────────────────────────────
// Helper: ABI-encode a (uint256, bool) report the same way the CRE workflow does
// ─────────────────────────────────────────────────────────────────────────────
function encodeReport(marketId, outcome) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "bool"],
    [marketId, outcome]
  );
}

// Arbitrary 10-byte workflow name (CRE passes this; our contract ignores it)
const WORKFLOW_NAME = ethers.zeroPadBytes(ethers.toUtf8Bytes("test"), 10);

describe("PredictionMarket", function () {
  let owner, alice, bob, carol, attacker;
  let market, forwarder;
  let MARKET_LIQUIDITY;

  const QUESTION = "Will Bitcoin reach $150k in 2025?";
  const MIN_BET = ethers.parseEther("0.1");
  const MAX_BET = ethers.parseEther("10");
  const PLATFORM_FEE_BPS = 150n; // 1.5%
  const RESOLUTION_BUFFER = 5 * 60; // 5 minutes in seconds

  beforeEach(async function () {
    [owner, alice, bob, carol, attacker, forwarder] = await ethers.getSigners();

    const PredictionMarket = await ethers.getContractFactory("PredictionMarket");
    market = await PredictionMarket.deploy(forwarder.address);

    MARKET_LIQUIDITY = await market.MARKET_LIQUIDITY(); // 0.01 ether

    // Seed the liquidity reserve so markets can be created
    await market.connect(owner).fundLiquidityReserve({ value: ethers.parseEther("100") });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Shared helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Creates a market where:
   *  - betting is open from "now+10" to "now+10+bettingDuration"
   *  - market ends at startTime + bettingDuration + duration
   *
   * The `marketOpen` modifier checks `block.timestamp < market.startTime`,
   * meaning bets must be placed BEFORE startTime.
   *
   * @param {number} bettingDuration  seconds bettors have BEFORE startTime (default 1000)
   * @param {number} duration         seconds the full market runs (default 7200)
   */
  async function createOpenMarket(bettingDuration = 1000, duration = 7200) {
    const latest = await ethers.provider.getBlock("latest");
    // startTime is in the future — bets are only accepted before startTime
    const startTime = latest.timestamp + bettingDuration;
    const endTime   = startTime + duration;
    await market.connect(owner).createMarket(QUESTION, startTime, endTime, MIN_BET, MAX_BET);
    return 1n; // first market is always ID 1
  }

  /**
   * Place bets while we are still before startTime.
   * Must be called right after createOpenMarket without advancing time past startTime.
   */
  async function placeBets(marketId) {
    await market.connect(alice).placeBet(marketId, true,  { value: ethers.parseEther("2")   });
    await market.connect(bob).placeBet(  marketId, false, { value: ethers.parseEther("3")   });
    await market.connect(carol).placeBet(marketId, true,  { value: ethers.parseEther("1.5") });
  }

  /**
   * Fast-forward past endTime + RESOLUTION_BUFFER so _resolveMarket can succeed.
   */
  async function fastForwardPastResolution(marketId) {
    const m = await market.getMarket(marketId);
    await ethers.provider.send("evm_setNextBlockTimestamp", [
      Number(m.endTime) + RESOLUTION_BUFFER + 1,
    ]);
    await ethers.provider.send("evm_mine");
  }

  /**
   * Fast-forward past endTime only (no buffer) — used when we want to test
   * "market has ended" but don't yet want resolution to succeed.
   */
  async function fastForwardPastEnd(marketId) {
    const m = await market.getMarket(marketId);
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(m.endTime) + 1]);
    await ethers.provider.send("evm_mine");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Deployment & Configuration
  // ─────────────────────────────────────────────────────────────────────────

  describe("Deployment & Configuration", function () {
    it("sets correct initial state", async function () {
      expect(await market.owner()).to.equal(owner.address);
      expect(await market.PLATFORM_FEE_BPS()).to.equal(150n);
      expect(await market.MARKET_LIQUIDITY()).to.equal(ethers.parseEther("0.01"));
      expect(await market.platformLiquidityReserve()).to.equal(ethers.parseEther("100"));
      expect(await market.forwarder()).to.equal(forwarder.address);
    });

    it("stores forwarder as immutable", async function () {
      expect(await market.forwarder()).to.equal(forwarder.address);
    });

    it("reverts on zero-address forwarder", async function () {
      const PredictionMarket = await ethers.getContractFactory("PredictionMarket");
      await expect(
        PredictionMarket.deploy(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid forwarder");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Market Creation
  // ─────────────────────────────────────────────────────────────────────────

  describe("Market Creation", function () {
    it("creates market and deducts liquidity from reserve", async function () {
      const latest = await ethers.provider.getBlock("latest");
      const startTime = latest.timestamp + 1000;
      const endTime   = startTime + 3600;

      await expect(
        market.createMarket(QUESTION, startTime, endTime, MIN_BET, MAX_BET)
      )
        .to.emit(market, "MarketCreated")
        .withArgs(1n, QUESTION, startTime, endTime, MIN_BET, MAX_BET, owner.address);

      const m = await market.getMarket(1n);
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
        market.createMarket(QUESTION, now - 1, now + 3600, MIN_BET, MAX_BET)
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
      const reserve = await market.platformLiquidityReserve();
      await market.withdrawLiquidityReserve(reserve);

      const now = (await ethers.provider.getBlock("latest")).timestamp;
      await expect(
        market.createMarket(QUESTION, now + 1000, now + 5000, MIN_BET, MAX_BET)
      ).to.be.revertedWith("Insufficient platform liquidity");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Placing Bets
  // ─────────────────────────────────────────────────────────────────────────

  describe("Placing Bets", function () {
    it("places YES bet and deducts fee correctly", async function () {
      const marketId = await createOpenMarket();
      const amount   = ethers.parseEther("2.5");
      const net      = (amount * (10000n - PLATFORM_FEE_BPS)) / 10000n;

      await expect(
        market.connect(alice).placeBet(marketId, true, { value: amount })
      )
        .to.emit(market, "BetPlaced")
        .withArgs(marketId, alice.address, net, true);

      const bet = await market.getUserBet(marketId, alice.address);
      expect(bet.amount).to.equal(net);
      expect(bet.side).to.be.true;
    });

    it("places NO bet correctly", async function () {
      const marketId = await createOpenMarket();
      const amount   = ethers.parseEther("1");
      const net      = (amount * (10000n - PLATFORM_FEE_BPS)) / 10000n;

      await market.connect(bob).placeBet(marketId, false, { value: amount });
      const bet = await market.getUserBet(marketId, bob.address);
      expect(bet.side).to.be.false;
      expect(bet.amount).to.equal(net);
    });

    it("enforces minimum bet", async function () {
      const marketId = await createOpenMarket();
      await expect(
        market.connect(alice).placeBet(marketId, true, { value: MIN_BET - 1n })
      ).to.be.revertedWith("Bet amount below minimum");
    });

    it("enforces maximum bet", async function () {
      const marketId = await createOpenMarket();
      await expect(
        market.connect(alice).placeBet(marketId, true, { value: MAX_BET + 1n })
      ).to.be.revertedWith("Bet amount above maximum");
    });

    it("prevents double betting from the same address", async function () {
      const marketId = await createOpenMarket();
      await market.connect(alice).placeBet(marketId, true, { value: MIN_BET });
      await expect(
        market.connect(alice).placeBet(marketId, false, { value: MIN_BET })
      ).to.be.revertedWith("Already bet on this market");
    });

    it("reverts after betting phase ends (once startTime passes)", async function () {
      const marketId = await createOpenMarket();
      // The marketOpen modifier checks block.timestamp < startTime.
      // Advance past startTime to close the betting window.
      const m = await market.getMarket(marketId);
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(m.startTime) + 1]);
      await ethers.provider.send("evm_mine");

      await expect(
        market.connect(alice).placeBet(marketId, true, { value: MIN_BET })
      ).to.be.revertedWith("Market betting phase has ended");
    });

    it("reverts on resolved market", async function () {
      const marketId = await createOpenMarket();
      await placeBets(marketId);
      await fastForwardPastResolution(marketId);
      await market.connect(owner).resolveMarket(marketId, true);

      await expect(
        market.connect(attacker).placeBet(marketId, true, { value: MIN_BET })
      ).to.be.revertedWith("Market is resolved");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. CRE Resolution via onReport
  // ─────────────────────────────────────────────────────────────────────────

  describe("CRE Resolution via onReport", function () {
    let marketId;

    beforeEach(async function () {
      marketId = await createOpenMarket(1000, 7200);
      await placeBets(marketId);
      // Fast-forward past endTime + RESOLUTION_BUFFER
      await fastForwardPastResolution(marketId);
    });

    it("forwarder can resolve market with outcome=true", async function () {
      const report = encodeReport(marketId, true);

      await expect(
        market.connect(forwarder).onReport(WORKFLOW_NAME, report)
      )
        .to.emit(market, "MarketResolved")
        .withArgs(marketId, true);

      const m = await market.getMarket(marketId);
      expect(m.resolved).to.be.true;
      expect(m.outcome).to.be.true;
    });

    it("forwarder can resolve market with outcome=false", async function () {
      const report = encodeReport(marketId, false);
      await market.connect(forwarder).onReport(WORKFLOW_NAME, report);

      const m = await market.getMarket(marketId);
      expect(m.resolved).to.be.true;
      expect(m.outcome).to.be.false;
    });

    it("reverts when caller is not the forwarder", async function () {
      const report = encodeReport(marketId, true);
      await expect(
        market.connect(attacker).onReport(WORKFLOW_NAME, report)
      ).to.be.revertedWith("Only forwarder");
    });

    it("reverts when market has not ended yet", async function () {
      // Create a fresh market whose endTime is far in the future.
      // _resolveMarket checks `block.timestamp >= endTime + RESOLUTION_BUFFER`;
      // when the market hasn't ended at all, that check fires as "Resolution buffer active".
      const latest = await ethers.provider.getBlock("latest");
      const startTime = latest.timestamp + 100;
      const endTime   = latest.timestamp + 9_999_999;
      await market.connect(owner).createMarket("Future market?", startTime, endTime, MIN_BET, MAX_BET);
      const futureMarketId = 2n;

      const report = encodeReport(futureMarketId, true);
      await expect(
        market.connect(forwarder).onReport(WORKFLOW_NAME, report)
      ).to.be.revertedWith("Resolution buffer active");
    });

    it("reverts when market has ended but resolution buffer is still active", async function () {
      // Create another market and advance only to endTime (not past the buffer)
      const latest = await ethers.provider.getBlock("latest");
      const startTime = latest.timestamp + 50;
      const endTime   = latest.timestamp + 500;
      await market.connect(owner).createMarket("Buffer test?", startTime, endTime, MIN_BET, MAX_BET);
      const bufferedMarketId = 2n;

      // Move to exactly endTime + 1, still inside the 5-minute buffer
      await ethers.provider.send("evm_setNextBlockTimestamp", [endTime + 1]);
      await ethers.provider.send("evm_mine");

      const report = encodeReport(bufferedMarketId, true);
      await expect(
        market.connect(forwarder).onReport(WORKFLOW_NAME, report)
      ).to.be.revertedWith("Resolution buffer active");
    });

    it("reverts on double resolution via onReport", async function () {
      const report = encodeReport(marketId, true);
      await market.connect(forwarder).onReport(WORKFLOW_NAME, report);

      await expect(
        market.connect(forwarder).onReport(WORKFLOW_NAME, report)
      ).to.be.revertedWith("Already resolved");
    });

    it("reverts for non-existent market", async function () {
      const report = encodeReport(999n, true);
      await expect(
        market.connect(forwarder).onReport(WORKFLOW_NAME, report)
      ).to.be.revertedWith("Market does not exist");
    });

    it("workflowName parameter is accepted and ignored", async function () {
      const otherName = ethers.zeroPadBytes(ethers.toUtf8Bytes("prod"), 10);
      const report    = encodeReport(marketId, true);
      await expect(
        market.connect(forwarder).onReport(otherName, report)
      ).to.emit(market, "MarketResolved");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Owner Manual Resolution (fallback)
  // ─────────────────────────────────────────────────────────────────────────

  describe("Owner Manual Resolution", function () {
    let marketId;

    beforeEach(async function () {
      marketId = await createOpenMarket(1000, 7200);
      await placeBets(marketId);
      await fastForwardPastResolution(marketId);
    });

    it("owner can resolve manually", async function () {
      await expect(market.connect(owner).resolveMarket(marketId, true))
        .to.emit(market, "MarketResolved")
        .withArgs(marketId, true);
    });

    it("non-owner cannot resolve manually", async function () {
      await expect(
        market.connect(alice).resolveMarket(marketId, true)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("cannot resolve before market ends (marketEnded modifier)", async function () {
      const latest = await ethers.provider.getBlock("latest");
      // Create a new market with endTime far in the future
      await market.createMarket(
        QUESTION,
        latest.timestamp + 100,
        latest.timestamp + 99_999,
        MIN_BET,
        MAX_BET
      );
      const newId = 2n;

      await expect(
        market.connect(owner).resolveMarket(newId, true)
      ).to.be.revertedWith("Market has not ended");
    });

    it("cannot resolve when resolution buffer is still active", async function () {
      const latest = await ethers.provider.getBlock("latest");
      const startTime = latest.timestamp + 50;
      const endTime   = latest.timestamp + 500;
      await market.createMarket("Buffer market?", startTime, endTime, MIN_BET, MAX_BET);
      const newId = 2n;

      // Advance to just after endTime but before buffer expires
      await ethers.provider.send("evm_setNextBlockTimestamp", [endTime + 1]);
      await ethers.provider.send("evm_mine");

      await expect(
        market.connect(owner).resolveMarket(newId, true)
      ).to.be.revertedWith("Resolution buffer active");
    });

    it("cannot resolve already-resolved market", async function () {
      await market.connect(owner).resolveMarket(marketId, true);
      await expect(
        market.connect(owner).resolveMarket(marketId, false)
      ).to.be.revertedWith("Already resolved");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Claiming Rewards
  // ─────────────────────────────────────────────────────────────────────────

  describe("Claiming Rewards", function () {
    let marketId;

    beforeEach(async function () {
      marketId = await createOpenMarket(1000, 7200);
      await placeBets(marketId);
      await fastForwardPastResolution(marketId);

      // Resolve via CRE forwarder — YES wins
      const report = encodeReport(marketId, true);
      await market.connect(forwarder).onReport(WORKFLOW_NAME, report);
    });

    it("winner receives more ETH than they started with", async function () {
      const before  = await ethers.provider.getBalance(alice.address);
      const tx      = await market.connect(alice).claimReward(marketId);
      const receipt = await tx.wait();
      const after   = await ethers.provider.getBalance(alice.address);

      // after + gas spent should exceed the starting balance
      expect(after + receipt.fee).to.be.gt(before);
    });

    it("loser cannot claim", async function () {
      await expect(
        market.connect(bob).claimReward(marketId)
      ).to.be.revertedWith("Not winning side");
    });

    it("cannot claim twice", async function () {
      await market.connect(alice).claimReward(marketId);
      await expect(
        market.connect(alice).claimReward(marketId)
      ).to.be.revertedWith("Already claimed");
    });

    it("claimFor works for winners", async function () {
      const before = await ethers.provider.getBalance(carol.address);
      await market.connect(owner).claimFor(marketId, carol.address);
      const after = await ethers.provider.getBalance(carol.address);
      expect(after).to.be.gt(before);
    });

    it("claimFor reverts for non-bettors", async function () {
      await expect(
        market.connect(owner).claimFor(marketId, attacker.address)
      ).to.be.revertedWith("No bet found");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Batch Claim For
  // ─────────────────────────────────────────────────────────────────────────

  describe("Batch Claim For", function () {
    let marketId;

    beforeEach(async function () {
      marketId = await createOpenMarket(1000, 7200);
      await placeBets(marketId);
      await fastForwardPastResolution(marketId);

      const report = encodeReport(marketId, true); // YES wins
      await market.connect(forwarder).onReport(WORKFLOW_NAME, report);
    });

    it("pays all winners in one call", async function () {
      const aliceBefore = await ethers.provider.getBalance(alice.address);
      const carolBefore = await ethers.provider.getBalance(carol.address);

      await market.batchClaimFor(marketId, [alice.address, carol.address]);

      expect(await ethers.provider.getBalance(alice.address)).to.be.gt(aliceBefore);
      expect(await ethers.provider.getBalance(carol.address)).to.be.gt(carolBefore);

      expect((await market.getUserBet(marketId, alice.address)).claimed).to.be.true;
      expect((await market.getUserBet(marketId, carol.address)).claimed).to.be.true;
    });

    it("silently skips already-claimed winners", async function () {
      await market.connect(alice).claimReward(marketId);
      // Should not revert; carol still gets paid
      const carolBefore = await ethers.provider.getBalance(carol.address);
      await market.batchClaimFor(marketId, [alice.address, carol.address]);
      expect(await ethers.provider.getBalance(carol.address)).to.be.gt(carolBefore);
    });

    it("silently skips losers", async function () {
      const bobBefore = await ethers.provider.getBalance(bob.address);
      await market.batchClaimFor(marketId, [bob.address]);
      // Bob's balance unchanged (he didn't call it himself, so no gas cost on his side)
      expect(await ethers.provider.getBalance(bob.address)).to.equal(bobBefore);
      expect((await market.getUserBet(marketId, bob.address)).claimed).to.be.false;
    });

    it("silently skips addresses that never bet", async function () {
      await expect(
        market.batchClaimFor(marketId, [attacker.address])
      ).to.not.be.reverted;
    });

    it("reverts when batch exceeds MAX_BATCH_SIZE", async function () {
      const tooMany = Array(101).fill(attacker.address);
      await expect(
        market.batchClaimFor(marketId, tooMany)
      ).to.be.revertedWith("Batch too large");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 8. Market Cancellation
  // ─────────────────────────────────────────────────────────────────────────

  describe("Market Cancellation", function () {
    let marketId;

    beforeEach(async function () {
      marketId = await createOpenMarket(1000, 7200);
    });

    it("owner can cancel an unresolved market", async function () {
      await expect(market.connect(owner).cancelMarket(marketId))
        .to.emit(market, "MarketCanceled")
        .withArgs(marketId, MARKET_LIQUIDITY);

      // Liquidity should be fully restored
      expect(await market.platformLiquidityReserve()).to.equal(ethers.parseEther("100"));
    });

    it("non-owner cannot cancel", async function () {
      await expect(
        market.connect(alice).cancelMarket(marketId)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("cannot cancel already-resolved market", async function () {
      await placeBets(marketId);
      await fastForwardPastResolution(marketId);
      await market.connect(owner).resolveMarket(marketId, true);

      await expect(
        market.connect(owner).cancelMarket(marketId)
      ).to.be.revertedWith("Cannot cancel resolved market");
    });

    it("bettor can claim refund after cancellation", async function () {
      // Place a bet then cancel the market
      await market.connect(alice).placeBet(marketId, true, { value: MIN_BET });
      await market.connect(owner).cancelMarket(marketId);

      const aliceBefore = await ethers.provider.getBalance(alice.address);
      const tx          = await market.connect(alice).claimRefund(marketId);
      const receipt     = await tx.wait();
      const aliceAfter  = await ethers.provider.getBalance(alice.address);

      // Alice should get her net bet back (bet minus entry fee already taken)
      expect(aliceAfter + receipt.fee).to.be.gt(aliceBefore);
    });

    it("claimRefund reverts if market not canceled", async function () {
      await market.connect(alice).placeBet(marketId, true, { value: MIN_BET });
      await expect(
        market.connect(alice).claimRefund(marketId)
      ).to.be.revertedWith("Market not canceled");
    });

    it("claimRefund reverts on double claim", async function () {
      await market.connect(alice).placeBet(marketId, true, { value: MIN_BET });
      await market.connect(owner).cancelMarket(marketId);
      await market.connect(alice).claimRefund(marketId);

      await expect(
        market.connect(alice).claimRefund(marketId)
      ).to.be.revertedWith("Already claimed");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 9. Fees & Liquidity Withdrawals
  // ─────────────────────────────────────────────────────────────────────────

  describe("Fees & Liquidity Withdrawals", function () {
    let marketId;

    beforeEach(async function () {
      marketId = await createOpenMarket(1000, 7200);
      await placeBets(marketId);
      await fastForwardPastResolution(marketId);

      const report = encodeReport(marketId, true);
      await market.connect(forwarder).onReport(WORKFLOW_NAME, report);

      await market.connect(alice).claimReward(marketId);
      await market.connect(carol).claimReward(marketId);
    });

    it("owner can withdraw collected platform fees", async function () {
      const fees   = await market.getWithdrawableFees();
      expect(fees).to.be.gt(0n);

      const before  = await ethers.provider.getBalance(owner.address);
      const tx      = await market.connect(owner).withdrawPlatformFees();
      const receipt = await tx.wait();
      const after   = await ethers.provider.getBalance(owner.address);

      // owner received fees minus gas
      expect(after - before + receipt.fee).to.be.closeTo(fees, ethers.parseEther("0.001"));
      expect(await market.totalCollectedFees()).to.equal(0n);
    });

    it("reverts when no fees to withdraw", async function () {
      await market.withdrawPlatformFees();
      await expect(market.withdrawPlatformFees()).to.be.revertedWith("No fees to withdraw");
    });

    it("owner can withdraw from liquidity reserve", async function () {
      const amount = ethers.parseEther("5");
      const before = await market.platformLiquidityReserve();

      await expect(market.withdrawLiquidityReserve(amount))
        .to.emit(market, "LiquidityReserveWithdrawn")
        .withArgs(amount);

      expect(await market.platformLiquidityReserve()).to.equal(before - amount);
    });

    it("non-owner cannot withdraw fees or liquidity", async function () {
      await expect(
        market.connect(alice).withdrawPlatformFees()
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        market.connect(alice).withdrawLiquidityReserve(1n)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("emergencyWithdrawFees sends collected fees to owner", async function () {
      // Ensure there are fees to withdraw (earned during placeBet calls in beforeEach)
      const feesBefore = await market.totalCollectedFees();
      // If fees were already withdrawn in this beforeEach path, re-accumulate
      if (feesBefore === 0n) {
        // Place another bet to generate fees
        const latest     = await ethers.provider.getBlock("latest");
        const startTime2 = latest.timestamp + 100;
        const endTime2   = startTime2 + 7200;
        await market.connect(owner).createMarket("Extra?", startTime2, endTime2, MIN_BET, MAX_BET);
        await market.connect(attacker).placeBet(2n, true, { value: MIN_BET });
      }

      const fees   = await market.totalCollectedFees();
      expect(fees).to.be.gt(0n);

      const before  = await ethers.provider.getBalance(owner.address);
      const tx      = await market.connect(owner).emergencyWithdrawFees();
      const receipt = await tx.wait();
      const after   = await ethers.provider.getBalance(owner.address);

      expect(after + receipt.fee).to.be.gt(before);
      expect(await market.totalCollectedFees()).to.equal(0n);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 10. getOdds Calculation
  // ─────────────────────────────────────────────────────────────────────────

  describe("getOdds Calculation", function () {
    let marketId;

    beforeEach(async function () {
      marketId = await createOpenMarket(1000, 7200);
    });

    it("returns equal fee-adjusted odds when pools are balanced", async function () {
      const [yesOdds, noOdds] = await market.getOdds(marketId);
      // Initial pools are equal so odds should match
      expect(yesOdds).to.equal(noOdds);
      // With 1.5% fee, 2.0000 fair odds → 1.9700 = 19700 in fixed-point
      expect(yesOdds).to.equal(19700n);
    });

    it("adjusts odds when pools become imbalanced", async function () {
      await market.connect(alice).placeBet(marketId, true,  { value: ethers.parseEther("4") });
      await market.connect(bob).placeBet(  marketId, false, { value: ethers.parseEther("1") });

      const [yesOdds, noOdds] = await market.getOdds(marketId);
      // YES pool is larger → lower payout odds for YES bettors
      expect(yesOdds).to.be.lt(noOdds);
    });

    it("applies fee adjustment — odds are worse than true probability", async function () {
      await market.connect(alice).placeBet(marketId, true, { value: ethers.parseEther("2") });
      const [yesOdds] = await market.getOdds(marketId);
      // Fee should push odds below what they'd be without the 1.5% cut
      expect(yesOdds).to.be.lt(30000n);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 11. View Helpers
  // ─────────────────────────────────────────────────────────────────────────

  describe("View Helpers", function () {
    let marketId;

    beforeEach(async function () {
      marketId = await createOpenMarket(1000, 7200);
    });

    it("getMarketCount increments on each market created", async function () {
      expect(await market.getMarketCount()).to.equal(1n);

      const latest = await ethers.provider.getBlock("latest");
      await market.createMarket("Second?", latest.timestamp + 100, latest.timestamp + 9999, MIN_BET, MAX_BET);
      expect(await market.getMarketCount()).to.equal(2n);
    });

    it("hasUserBet returns false before bet, true after", async function () {
      expect(await market.hasUserBet(marketId, alice.address)).to.be.false;
      await market.connect(alice).placeBet(marketId, true, { value: MIN_BET });
      expect(await market.hasUserBet(marketId, alice.address)).to.be.true;
    });

    it("getMarketVolume returns 0 with only initial liquidity", async function () {
      expect(await market.getMarketVolume(marketId)).to.equal(0n);
    });

    it("getMarketVolume counts real bets", async function () {
      await market.connect(alice).placeBet(marketId, true, { value: ethers.parseEther("2") });
      const vol = await market.getMarketVolume(marketId);
      expect(vol).to.be.gt(0n);
    });

    it("getPlatformStats returns consistent accounting", async function () {
      const stats = await market.getPlatformStats();
      // contractBalance = 100 ETH seeded reserve - MARKET_LIQUIDITY (still in contract) = still 100 ETH
      // The MARKET_LIQUIDITY is deducted from the *accounting* variable but stays in the contract
      expect(stats.contractBalance).to.equal(
        ethers.parseEther("100") // seeded reserve, all still in contract
      );
    });

    it("getPlatformProfit equals lifetimeFees minus withdrawnFees", async function () {
      expect(await market.getPlatformProfit()).to.equal(0n); // nothing collected yet
    });

    it("getPlatformProfit increases after bets are placed", async function () {
      await market.connect(alice).placeBet(marketId, true, { value: ethers.parseEther("2") });
      expect(await market.getPlatformProfit()).to.be.gt(0n);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 12. Liquidity Reserve Funding
  // ─────────────────────────────────────────────────────────────────────────

  describe("Liquidity Reserve Funding", function () {
    it("owner can fund the liquidity reserve", async function () {
      const amount = ethers.parseEther("10");
      const before = await market.platformLiquidityReserve();

      await expect(
        market.connect(owner).fundLiquidityReserve({ value: amount })
      )
        .to.emit(market, "LiquidityReserveFunded")
        .withArgs(amount);

      expect(await market.platformLiquidityReserve()).to.equal(before + amount);
    });

    it("reverts if zero ETH sent to fundLiquidityReserve", async function () {
      await expect(
        market.connect(owner).fundLiquidityReserve({ value: 0 })
      ).to.be.revertedWith("Must send ETH to fund reserve");
    });

    it("non-owner cannot fund liquidity reserve", async function () {
      await expect(
        market.connect(alice).fundLiquidityReserve({ value: ethers.parseEther("1") })
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 13. receive() fallback
  // ─────────────────────────────────────────────────────────────────────────

  describe("receive() fallback", function () {
    it("accepts plain ETH transfers", async function () {
      const amount = ethers.parseEther("1");
      const before = await ethers.provider.getBalance(market.target);
      await alice.sendTransaction({ to: market.target, value: amount });
      const after = await ethers.provider.getBalance(market.target);
      expect(after - before).to.equal(amount);
    });
  });
});