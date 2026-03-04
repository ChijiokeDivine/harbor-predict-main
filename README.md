# Harbor Predict - Prediction Market Contract

> **A simple prediction market smart contract** enabling decentralized binary outcome betting with automated reward distribution, liquidity management, and platform fee collection.

<div align="center">

![Solidity](https://img.shields.io/badge/Solidity-^0.8.19-363636?style=flat-square&logo=solidity)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)
![Hardhat](https://img.shields.io/badge/Hardhat-Latest-F3A821?style=flat-square&logo=hardhat)

</div>

---

## 📋 Table of Contents
- [Quick Start](#-quick-start)
- [Project Structure](#-project-structure)
- [Setup & Installation](#-setup--installation)
- [Network Configuration](#-network-configuration)
- [Compilation & Testing](#-compilation--testing)
- [Deployment Guide](#-deployment-guide)
- [Contract Architecture](#-contract-architecture)
- [Core Functions](#-core-functions)
- [Market Lifecycle](#-market-lifecycle)
- [Fee Structure](#-fee-structure)
- [Important Constants](#-important-constants)
- [Integration Examples](#-integration-examples)
- [Security Features](#-security-features)
- [Troubleshooting](#-troubleshooting)
- [License](#-license)

---

## 🚀 Quick Start

```bash
# Clone and setup
git clone https://github.com/ChijiokeDivine/harbor-predict-main
cd harbor-predict-main

# Install dependencies
npm install
# or with pnpm
pnpm install

# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test

# Deploy to Base Sepolia testnet
npx hardhat run scripts/deploy.js --network sepolia
```

---

## 📁 Project Structure

```
harbor-predict/
├── contracts/
│   ├── PredictionMarket.sol      # Main contract
│   ├── MockFunctionsRouter.sol   # Router mock for testing
│   └── MockRejectingReceiver.sol # Test utilities
├── scripts/
│   └── deploy.js                 # Deployment script
├── test/
│   └── test.js                   # Comprehensive test suite (26+ cases)
├── artifacts/                    # Compiled contract artifacts
├── hardhat.config.js             # Hardhat configuration
├── .env                          # Environment variables
├── package.json
└── README.md
```

---

## 🛠️ Setup & Installation

### Prerequisites
- **Node.js** v16+ or v18+ recommended
- **npm** or **pnpm** package manager
- Basic knowledge of Ethereum and Solidity

### Step 1: Clone Repository
```bash
git clone https://github.com/awortuibenem/harbor-predict
cd harbor-predict-main/harbor-predict-main
```

### Step 2: Install Dependencies
```bash
npm install
# or
pnpm install
```

This installs:
- `hardhat` - Development environment
- `@nomicfoundation/hardhat-toolbox` - Essential plugins
- `@openzeppelin/contracts` - Secure contract libraries
- `ethers.js` - Ethereum interaction library
- `dotenv` - Environment variable management

### Step 3: Configure Environment Variables
Create a `.env` file in the root directory:

```env
PRIVATE_KEY=your_64_character_hex_private_key_here
CONTRACT_ADDRESS=your_deployed_contract_address_here
BASE_CONTRACT_ADDRESS=forwarder_contract_address_here
ALCHEMY_API_KEY=your_alchemy_api_key_here
```

> ⚠️ **SECURITY WARNING**: Never commit `.env` to version control. Always use `.gitignore`.

---

## 🌐 Network Configuration

### Supported Networks

| Network | Status | Chain ID | RPC Endpoint |
|---------|--------|----------|-------------|
| **Base Sepolia** | ✅ Active | 84532 | Alchemy |
| **Localhost** | ✅ Development | 1337 | http://127.0.0.1:8545 |
| **Hardhat** | ✅ Testing | 1337 | Internal |

### Hardhat Configuration

```javascript
// hardhat.config.js excerpt
networks: {
  sepolia: {
    url: `https://base-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
    chainId: 84532,
    accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    gasPrice: 10000000  // 10 gwei
  },
  hardhat: {
    chainId: 1337
  }
}
```

---

## 🔨 Compilation & Testing

### Compile Contracts
```bash
npx hardhat compile
```

**Output**: Generates artifacts in `./artifacts` folder with:
- ABI files
- Contract bytecode
- Debug information

### Run Test Suite
```bash
npx hardhat test
```

**Test Coverage**: 26+ comprehensive test cases covering:
- ✓ Market creation and initialization
- ✓ Bet placement with fee deduction
- ✓ Market resolution mechanisms
- ✓ Single and batch reward claims
- ✓ Refund logic for canceled markets
- ✓ Edge cases and error scenarios
- ✓ Reentrancy attack prevention
- ✓ Liquidity reserve management

### Run Tests with Gas Reporter
```bash
REPORT_GAS=true npx hardhat test
```

---

## 🚢 Deployment Guide

### Step 1: Add Funds to Your Wallet
1. Visit [Base Sepolia Faucet](https://www.alchemy.com/faucets/base-sepolia)
2. Enter your wallet address
3. Claim test ETH

### Step 2: Update Forwarder Address
Edit `scripts/deploy.js` and set the correct `FORWARDER_ADDRESS`:

```javascript
const FORWARDER_ADDRESS = "0x82300bd7c3958625581cc2f77bc6464dcecdf3e5";
```

### Step 3: Run Deployment Script
```bash
npx hardhat run scripts/deploy.js --network sepolia
```

**Expected Output**:
```
ℹ️ Deploying from address: 0x...
ℹ️ Network: sepolia
ℹ️ Account balance: 10.5 ETH
⏳ Deploying PredictionMarket...
✅ PredictionMarket deployed to: 0x1234...
ℹ️ Transaction hash: 0x5678...
```

### Step 4: Save Contract Address
Update your `.env` file:
```env
CONTRACT_ADDRESS=0x1234...(your_new_contract_address)
```

---

## 🏗️ Contract Architecture

### Data Structures

#### Market Structure
```solidity
struct Market {
    uint256 id;                  // Unique market ID
    uint256 startTime;           // Betting start (Unix timestamp)
    uint256 endTime;             // Betting end + resolution window
    uint256 minBet;              // Minimum bet amount (Wei)
    uint256 maxBet;              // Maximum bet amount (Wei)
    uint256 yesPool;             // Total YES side liquidity
    uint256 noPool;              // Total NO side liquidity
    address creator;             // Market creator address
    string question;             // Markets question/description
    bool resolved;               // Resolution status
    bool outcome;                // Final outcome (true=YES, false=NO)
    bool exists;                 // Existence flag
    bool canceled;               // Cancellation status
    uint256 totalClaimed;        // Total payout distributed
}
```

#### Bet Structure
```solidity
struct Bet {
    uint256 amount;              // Bet stake (after fees)
    bool claimed;                // Claim status
    bool side;                   // Prediction (true=YES, false=NO)
}
```

### Contract Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    PREDICTION MARKET LIFECYCLE                  │
└─────────────────────────────────────────────────────────────────┘

   [1] CREATE              [2] BETTING         [3] RESOLUTION
   ────────               ────────────        ──────────────
   
   Owner funds             Users place bets    Wait for endTime
   liquidity reserve       (YES/NO)            + 5 min buffer
        ↓                      ↓                        ↓
   createMarket()         placeBet()      onReport() / resolveMarket()
        ↓                      ↓                        ↓
   Market initialized     Bets recorded      Market marked RESOLVED
   Initial pools set      Fees collected     Outcome recorded
        │                      │                        │
        │                      │                        │
        └──────────────────────┴────────────────────────┘
                              ↓
                    [4] CLAIM REWARDS
                    ──────────────────
                    
                    Winners call:
                    • claimReward()
                    • batchClaimFor()
                    • claimFor()
                            ↓
                    Calculate pro-rata share
                    Deduct 1.5% platform fee
                    Send payout
                            ↓
                    ✅ Rewards distributed
```

---

## 💪 Core Functions

### 📌 Market Management Functions

#### `createMarket()`
Creates a new binary outcome prediction market.

```solidity
function createMarket(
    string calldata question,
    uint256 startTime,
    uint256 endTime,
    uint256 minBet,
    uint256 maxBet
) external
```

**Parameters:**
| Param | Type | Description | Example |
|-------|------|-------------|---------|
| `question` | string | Market question | "Will ETH hit $10K by EOY?" |
| `startTime` | uint256 | Betting start (Unix timestamp) | 1704067200 |
| `endTime` | uint256 | Betting end (Unix timestamp) | 1704153600 |
| `minBet` | uint256 | Minimum bet (Wei) | 10^18 (1 ETH) |
| `maxBet` | uint256 | Maximum bet (Wei) | 10^19 (10 ETH) |

**Requirements:**
- startTime > current block timestamp
- endTime > startTime
- minBet > 0 and < maxBet
- Platform liquidity reserve ≥ 0.01 ETH
- Question cannot be empty

**Example:**
```javascript
const tx = await predictionMarket.createMarket(
  "Will Bitcoin reach $100k in 2024?",
  Math.floor(Date.now() / 1000) + 86400,    // 1 day from now
  Math.floor(Date.now() / 1000) + 604800,   // 7 days from now
  ethers.parseEther("0.1"),                 // Min 0.1 ETH
  ethers.parseEther("5")                    // Max 5 ETH
);
```

---

#### `placeBet()`
Place a bet on a specific market outcome.

```solidity
function placeBet(uint256 marketId, bool side) external payable
```

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `marketId` | uint256 | Market ID to bet on |
| `side` | bool | Prediction (true = YES, false = NO) |
| `msg.value` | uint256 | Bet amount (sent with transaction) |

**Fee Calculation:**
- Platform Fee: **150 bps (1.5%)**
- Net stake = msg.value - (msg.value × 150 / 10000)

**Example:**
```javascript
const tx = await predictionMarket.placeBet(1, true, {
  value: ethers.parseEther("2")  // Will deduct 0.03 ETH as fee
});
// User's stake: 1.97 ETH added to YES pool
```

**Requirements:**
- Market must exist and not be resolved
- Betting phase must not have ended
- Bet must be within min/max range
- User can only bet once per market

---

#### `resolveMarket()`
Resolve a market with the outcomes (Owner only).

```solidity
function resolveMarket(uint256 marketId, bool outcome) 
    external onlyOwner
```

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `marketId` | uint256 | Market to resolve |
| `outcome` | bool | Final result (true = YES wins, false = NO wins) |

**Requirements:**
- Only contract owner can call
- Market must exist and not already resolved
- Block timestamp must be ≥ endTime

**Example:**
```javascript
const tx = await predictionMarket.resolveMarket(1, true);
// YES side wins market 1
```

---

### 🏆 Reward Claim Functions

#### `claimReward()`
Claim reward for the calling user on a resolved market.

```solidity
function claimReward(uint256 marketId) external nonReentrant
```

**Reward Calculation:**
```
userReward = (userBet × totalPool) / winningPool
platformFee = userReward × 150 / 10000
userPayout = userReward - platformFee
```

**Example:**
```javascript
// Market: 100 ETH YES pool, 50 ETH NO pool
// User bet 10 ETH on YES (YES wins)
// userReward = (10 × 150) / 100 = 15 ETH
// platformFee = 15 × 1.5% = 0.225 ETH
// userPayout = 14.775 ETH

const tx = await predictionMarket.claimReward(1);
```

---

#### `claimFor()`
Claim reward for another user (gas optimization).

```solidity
function claimFor(uint256 marketId, address user) 
    external nonReentrant
```

**Use Case**: Batch processing rewards for multiple users.

---

#### `batchClaimFor()`
Distribute rewards to multiple users in a single transaction.

```solidity
function batchClaimFor(
    uint256 marketId,
    address[] calldata users
) external nonReentrant
```

**Constraints:**
- Maximum 100 users per call (MAX_BATCH_SIZE)
- Single gas-optimized storage write
- Automatically skips already-claimed or invalid bets

**Example:**
```javascript
const users = [addr1, addr2, addr3, addr4, addr5];
const tx = await predictionMarket.batchClaimFor(1, users);
// All 5 users claim rewards in one transaction
```

---

#### `claimRefund()`
Claim full refund when market is canceled.

```solidity
function claimRefund(uint256 marketId) external nonReentrant
```

**Example:**
```javascript
const tx = await predictionMarket.claimRefund(1);
// Get full bet amount back (minus original fee)
```

---

### ⚙️ Admin Functions

#### `fundLiquidityReserve()`
Fund the platform liquidity reserve (for market creation).

```solidity
function fundLiquidityReserve() external payable onlyOwner
```

**Purpose**: Markets require 0.01 ETH liquidity (split 50/50 between YES/NO pools).

**Example:**
```javascript
const tx = await predictionMarket.fundLiquidityReserve({
  value: ethers.parseEther("1")  // Add 1 ETH to reserve
});
```

---

#### `cancelMarket()`
Cancel a market and allow refunds (Owner only).

```solidity
function cancelMarket(uint256 marketId) external onlyOwner
```

**Requirements:**
- Market must exist
- Market must not already be resolved

**Example:**
```javascript
const tx = await predictionMarket.cancelMarket(1);
// All users can now claim refunds
```

---

#### `withdrawPlatformFees()`
Withdraw accumulated platform fees.

```solidity
function withdrawPlatformFees() external onlyOwner
```

**Example:**
```javascript
const tx = await predictionMarket.withdrawPlatformFees();
// Transfer all collected fees to owner wallet
```

---

#### `withdrawLiquidityReserve()`
Withdraw from liquidity reserve.

```solidity
function withdrawLiquidityReserve(uint256 amount) external onlyOwner
```

**Example:**
```javascript
const tx = await predictionMarket.withdrawLiquidityReserve(
  ethers.parseEther("0.5")
);
```

---

### 📊 View Functions

#### `getMarket()`
Retrieve complete market information.

```solidity
function getMarket(uint256 marketId) 
    external view returns (Market memory)
```

**Returns:** Full `Market` struct with all details.

```javascript
const market = await predictionMarket.getMarket(1);
console.log(market.question);      // "Will it rain?"
console.log(market.yesPool);       // 50000000000000000000 (50 ETH)
console.log(market.noPool);        // 30000000000000000000 (30 ETH)
console.log(market.resolved);      // true
console.log(market.outcome);       // true (YES wins)
```

---

#### `getUserBet()`
Get a user's bet on a specific market.

```solidity
function getUserBet(uint256 marketId, address user) 
    external view returns (Bet memory)
```

```javascript
const bet = await predictionMarket.getUserBet(1, walletAddress);
console.log(bet.amount);    // User's stake (after fees)
console.log(bet.side);      // true (YES) or false (NO)
console.log(bet.claimed);   // true/false
```

---

#### `getMarketCount()`
Get total number of markets created.

```javascript
const count = await predictionMarket.getMarketCount();
console.log(count);  // 42
```

---

#### `getOdds()`
Calculate current odds for both sides.

```solidity
function getOdds(uint256 marketId) 
    external view returns (uint256 yesOdds, uint256 noOdds)
```

**Returns:** Decimal-scaled odds (10000 = 1.0)

```javascript
const [yesOdds, noOdds] = await predictionMarket.getOdds(1);
console.log(yesOdds / 10000);  // e.g., 1.25 = 5/4 odds
console.log(noOdds / 10000);   // e.g., 3.33 = 10/3 odds
```

---

#### `getPlatformStats()`
Get comprehensive platform statistics.

```solidity
function getPlatformStats() external view returns (
    uint256 lifetimeFees,
    uint256 withdrawnFees,
    uint256 withdrawableFees,
    uint256 liquidityReserve,
    uint256 contractBalance
)
```

```javascript
const stats = await predictionMarket.getPlatformStats();
console.log("Lifetime fees collected:", ethers.formatEther(stats[0]));
console.log("Fees withdrawn:", ethers.formatEther(stats[1]));
console.log("Available to withdraw:", ethers.formatEther(stats[2]));
console.log("Liquidity reserve:", ethers.formatEther(stats[3]));
console.log("Contract balance:", ethers.formatEther(stats[4]));
```

### Resolving a Market (Owner Only)
```js
await predictionMarket.resolveMarket(1, true); // true = YES wins
```

### Claiming Rewards
```js
await predictionMarket.claimReward(1);
```

### Emergency Withdraw (Owner Only)
```js
await predictionMarket.emergencyWithdraw();
```

### Cancel Market (Owner Only)
```js
await predictionMarket.cancelMarket(1);
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