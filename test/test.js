const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ethers: ethersLib } = require("ethers");

describe("PredictionMarket", function () {
  let PredictionMarket, predictionMarket, owner, user1, user2, user3;
  let minBet, maxBet, endTime;
  const question = "Will it rain tomorrow?";

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();
    PredictionMarket = await ethers.getContractFactory("PredictionMarket");
    predictionMarket = await PredictionMarket.deploy();
    minBet = ethersLib.parseEther("1");
    maxBet = ethersLib.parseEther("5");
    endTime = (await ethers.provider.getBlock("latest")).timestamp + 3600;
  });

  describe("Market Creation", function () {
    it("should create a market with valid parameters", async function () {
      await expect(predictionMarket.createMarket(question, endTime, minBet, maxBet))
        .to.emit(predictionMarket, "MarketCreated")
        .withArgs(1, question, endTime, minBet, maxBet, owner.address);

      const market = await predictionMarket.getMarket(1);
      expect(market.question).to.equal(question);
      expect(market.minBet).to.equal(minBet);
      expect(market.maxBet).to.equal(maxBet);
      expect(market.exists).to.be.true;
    });

    it("should fail if end time is in the past", async function () {
      await expect(
        predictionMarket.createMarket(question, 1, minBet, maxBet)
      ).to.be.revertedWith("End time must be in the future");
    });

    it("should fail if minBet is zero", async function () {
      await expect(
        predictionMarket.createMarket(question, endTime, 0, maxBet)
      ).to.be.revertedWith("Min bet must be greater than 0");
    });

    it("should fail if maxBet is not greater than minBet", async function () {
      await expect(
        predictionMarket.createMarket(question, endTime, minBet, minBet)
      ).to.be.revertedWith("Max bet must be greater than min bet");
    });

    it("should fail if question is empty", async function () {
      await expect(
        predictionMarket.createMarket("", endTime, minBet, maxBet)
      ).to.be.revertedWith("Question cannot be empty");
    });
  });

  describe("Placing Bets", function () {
    beforeEach(async function () {
      await predictionMarket.createMarket(question, endTime, minBet, maxBet);
    });

    it("should allow a user to place a valid bet on YES", async function () {
      await expect(
        predictionMarket.connect(user1).placeBet(1, true, { value: minBet })
      ).to.emit(predictionMarket, "BetPlaced")
        .withArgs(1, user1.address, minBet, true);

      const bet = await predictionMarket.getUserBet(1, user1.address);
      expect(bet.amount).to.equal(minBet);
      expect(bet.side).to.equal(true);
      expect(bet.claimed).to.be.false;
    });

    it("should allow a user to place a valid bet on NO", async function () {
      await expect(
        predictionMarket.connect(user2).placeBet(1, false, { value: maxBet })
      ).to.emit(predictionMarket, "BetPlaced")
        .withArgs(1, user2.address, maxBet, false);
    });

    it("should fail if user already bet on the market", async function () {
      await predictionMarket.connect(user1).placeBet(1, true, { value: minBet });
      await expect(
        predictionMarket.connect(user1).placeBet(1, false, { value: minBet })
      ).to.be.revertedWith("User has already bet on this market");
    });

    it("should fail if bet is below minBet", async function () {
      await expect(
        predictionMarket.connect(user1).placeBet(1, true, { value: minBet - 1n })
      ).to.be.revertedWith("Bet amount below minimum");
    });

    it("should fail if bet is above maxBet", async function () {
      await expect(
        predictionMarket.connect(user1).placeBet(1, true, { value: maxBet + 1n })
      ).to.be.revertedWith("Bet amount above maximum");
    });
  });

  describe("Market Resolution", function () {
    beforeEach(async function () {
      await predictionMarket.createMarket(question, endTime, minBet, maxBet);
      await predictionMarket.connect(user1).placeBet(1, true, { value: minBet });
      await predictionMarket.connect(user2).placeBet(1, false, { value: maxBet });
      await ethers.provider.send("evm_increaseTime", [4000]);
      await ethers.provider.send("evm_mine");
    });

    it("should only allow owner to resolve", async function () {
      await expect(
        predictionMarket.connect(user1).resolveMarket(1, true)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should fail if market not ended", async function () {
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      await predictionMarket.createMarket("Q2", now + 5000, minBet, maxBet);
      await expect(
        predictionMarket.resolveMarket(2, true)
      ).to.be.revertedWith("Market has not ended");
    });

    it("should resolve and emit event", async function () {
      await expect(predictionMarket.resolveMarket(1, true))
        .to.emit(predictionMarket, "MarketResolved")
        .withArgs(1, true);
    });

    it("should fail if already resolved", async function () {
      await predictionMarket.resolveMarket(1, true);
      await expect(
        predictionMarket.resolveMarket(1, false)
      ).to.be.revertedWith("Market already resolved");
    });
  });

  describe("Claiming Rewards", function () {
    beforeEach(async function () {
      await predictionMarket.createMarket(question, endTime, minBet, maxBet);
      await predictionMarket.connect(user1).placeBet(1, true, { value: minBet });
      await predictionMarket.connect(user2).placeBet(1, false, { value: maxBet });
      await ethers.provider.send("evm_increaseTime", [4000]);
      await ethers.provider.send("evm_mine");
      await predictionMarket.resolveMarket(1, true);
    });

    it("should allow winner to claim reward", async function () {
      const totalPool = minBet + maxBet;
      const expectedReward = totalPool; // winner gets the full pool since only one bet on YES
      await expect(predictionMarket.connect(user1).claimReward(1))
        .to.emit(predictionMarket, "RewardClaimed")
        .withArgs(1, user1.address, expectedReward);
    });

    it("should fail if user did not bet on winning side", async function () {
      await expect(
        predictionMarket.connect(user2).claimReward(1)
      ).to.be.revertedWith("User did not bet on winning side");
    });

    it("should fail if reward already claimed", async function () {
      await predictionMarket.connect(user1).claimReward(1);
      await expect(
        predictionMarket.connect(user1).claimReward(1)
      ).to.be.revertedWith("Reward already claimed");
    });

    it("should fail if no bet found for user", async function () {
      await expect(
        predictionMarket.connect(user3).claimReward(1)
      ).to.be.revertedWith("No bet found for this user");
    });
  });

  describe("Emergency Withdraw", function () {
    beforeEach(async function () {
      await predictionMarket.createMarket(question, endTime, minBet, maxBet);
      await predictionMarket.connect(user1).placeBet(1, true, { value: minBet });
    });

    it("should allow only owner to withdraw all funds", async function () {
      const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
      // Removed event assertion as EmergencyWithdrawal event does not exist in contract
      await predictionMarket.emergencyWithdraw();
      const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);
      expect(ownerBalanceAfter).to.be.above(ownerBalanceBefore);
    });

    it("should not allow non-owner to withdraw", async function () {
      await expect(
        predictionMarket.connect(user1).emergencyWithdraw()
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Cancel Market", function () {
    beforeEach(async function () {
      await predictionMarket.createMarket(question, endTime, minBet, maxBet);
    });

    it("should allow only owner to cancel", async function () {
      await expect(predictionMarket.cancelMarket(1)).to.not.be.reverted;
      const market = await predictionMarket.getMarket(1);
      expect(market.resolved).to.be.true;
    });

    it("should not allow canceling resolved market", async function () {
      await predictionMarket.cancelMarket(1);
      await expect(
        predictionMarket.cancelMarket(1)
      ).to.be.revertedWith("Cannot cancel resolved market");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await predictionMarket.createMarket(question, endTime, minBet, maxBet);
      await predictionMarket.connect(user1).placeBet(1, true, { value: minBet });
    });

    it("should return correct market count", async function () {
      expect(await predictionMarket.getMarketCount()).to.equal(1);
    });

    it("should return correct odds", async function () {
      const [yesOdds, noOdds] = await predictionMarket.getOdds(1);
      // Convert to BigInt if it is returned as a string to prevent it failing
      const yes = typeof yesOdds === 'bigint' ? yesOdds : BigInt(yesOdds);
      const no = typeof noOdds === 'bigint' ? noOdds : BigInt(noOdds);
      expect(yes + no).to.equal(10000n);
    });

    it("should return correct user bet", async function () {
      const bet = await predictionMarket.getUserBet(1, user1.address);
      expect(bet.amount).to.equal(minBet);
    });

    it("should return correct user bet status", async function () {
      expect(await predictionMarket.hasUserBet(1, user1.address)).to.be.true;
      expect(await predictionMarket.hasUserBet(1, user2.address)).to.be.false;
    });
  });
});
