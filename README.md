# PredictionMarket Smart Contract

A simple prediction market smart contract system for Ethereum-compatible blockchains (tested on Monad Testnet).

## Table of Contents
- [Installation](#installation)
- [Compilation](#compilation)
- [Testing](#testing)
- [Deployment](#deployment)
- [Usage](#usage)
- [Contract Functions](#contract-functions)
- [Notes](#notes)
- [License](#license)

## Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/awortuibenem/harbor-predict
   cd predict or whatever dir you cloned it into
   ```
2. **Install dependencies:**
   ```bash
   npm install
   ```

## Compilation

Compile the smart contracts using Hardhat:
```bash
npx hardhat compile
```

## Testing

A comprehensive test suite with 26 cases covers all features of the smart contract. To run the tests (ensure you have compiled the contract first):
```bash
npx hardhat test
```

## Deployment

### Local Network (Hardhat)
1. **Start a local Hardhat node** (in a separate terminal):
   ```bash
   npx hardhat node
   ```
2. **Deploy the contract:**
   ```bash
   npx hardhat run scripts/deploy.js --network localhost
   ```

### Monad Testnet
1. **Set your private key as an environment variable:**
   ```bash
   export PRIVATE_KEY=your_private_key
   ```
2. **Deploy to Monad Testnet:**
   ```bash
   npx hardhat run scripts/deploy.js --network monad-testnet
   ```

## Usage

### Creating a Market
Call `createMarket(string question, uint256 endTime, uint256 minBet, uint256 maxBet)` from your dApp or via Hardhat console. Example:
```js
await predictionMarket.createMarket(
  "Will it rain tomorrow?",
  Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
  ethers.parseEther("1"),
  ethers.parseEther("5")
);
```

### Placing a Bet
Call `placeBet(uint256 marketId, bool side)` and send ETH value within min/max bet:
```js
await predictionMarket.placeBet(1, true, { value: ethers.parseEther("2") });
```

### Resolving a Market
```js
await predictionMarket.resolveMarket(1, true); // true = YES wins
```

### Claiming Rewards
```js
await predictionMarket.claimReward(1);
```


## Contract Functions
- `createMarket(question, endTime, minBet, maxBet)`
- `placeBet(marketId, side)`
- `resolveMarket(marketId, outcome)`
- `claimReward(marketId)`
- `emergencyWithdraw()`
- `cancelMarket(marketId)`
- View functions: `getMarket`, `getUserBet`, `hasUserBet`, `getMarketCount`, `getOdds`

## Notes
- Only the contract owner can resolve, cancel, or emergency withdraw.
- All times are in Unix timestamp (seconds).
- All bets and payouts are in ETH (not MONAD).

## License
MIT 
