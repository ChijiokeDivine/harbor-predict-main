# 🎯 Harbor Predict - Smart Prediction Market Contract

> **A sophisticated, gas-optimized prediction market smart contract** enabling decentralized binary outcome betting with automated reward distribution, liquidity management, and platform fee collection.

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
git clone https://github.com/awortuibenem/harbor-predict
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

---

#### `getMarketVolume()`
Get user trading volume on a market (excludes initial liquidity).

```solidity
function getMarketVolume(uint256 marketId) 
    external view marketExists(marketId) returns (uint256)
```

```javascript
const volume = await predictionMarket.getMarketVolume(1);
console.log("Trading volume:", ethers.formatEther(volume));
```

---

## 📈 Market Lifecycle

### Detailed Timeline

```
┌─────────────────────────────────────────────────────────────┐
│              MARKET STATE TRANSITIONS                        │
└─────────────────────────────────────────────────────────────┘

State: CREATED → OPEN → CLOSED → RESOLVED → CLAIMED
─────────────────────────────────────────────────────

[CREATED]
├─ Market initialized with liquidity
├─ Initial YES/NO pools: 0.005 ETH each
├─ Exists = true, Resolved = false
└─ Event: MarketCreated

      ↓
      
[OPEN FOR BETTING]
├─ block.timestamp < startTime ✓
├─ Users can placeBet(marketId, side)
├─ Bets recorded, fees collected
├─ Pools updated dynamically
└─ Event: BetPlaced

      ↓ (when block.timestamp >= endTime)
      
[BETTING CLOSED]
├─ No new bets accepted
├─ Waiting for resolution
└─ Next: resolveMarket() call

      ↓
      
[RESOLUTION BUFFER]
├─ 5 minute buffer after endTime
├─ Prevents immediate resolution
├─ Block timestamp must be ≥ endTime + 300 seconds
└─ Then: _resolveMarket() or onReport()

      ↓
      
[RESOLVED]
├─ Resolved = true
├─ Outcome recorded (YES/NO)
├─ Event: MarketResolved
└─ Ready for claims

      ↓
      
[CLAIMS DISTRIBUTED]
├─ Winners call: claimReward(), claimFor(), batchClaimFor()
├─ Losers receive nothing
├─ Refund eligible users call: claimRefund()
└─ Event: RewardClaimed
```

---

## 💸 Fee Structure

### Fee Configuration

| Item | Value | Details |
|------|-------|---------|
| **Platform Fee** | 150 bps | 1.5% of all bets & rewards |
| **Market Liquidity** | 0.01 ETH | Required to create market |
| **Liquidity Split** | 50/50 | 0.005 ETH per side (YES/NO) |

### Fee Flow Diagram

```
User Bet: 10 ETH
    │
    ├─ Calculate Fee: 10 × 150 / 10000 = 0.15 ETH
    │
    ├─ Net Stake: 10 - 0.15 = 9.85 ETH
    │
    └─ Add to Pool (YES or NO)
    
    [At Claim Time]
    
Winner's Payout Calculation:
    │
    ├─ Total Pool: 100 ETH (50 YES + 50 NO)
    ├─ Winning Pool: 50 ETH (YES wins)
    │
    ├─ User's Gross Reward: (9.85 × 100) / 50 = 19.70 ETH
    │
    ├─ Fee on Reward: 19.70 × 150 / 10000 = 0.2955 ETH
    │
    └─ User's Net Payout: 19.70 - 0.2955 = 19.4045 ETH
```

### Fee Collection Routes

1. **placeBet()** → Deducts fee immediately
2. **claimReward()** → Deducts fee from calculated reward
3. **batchClaimFor()** → Batched fee collection (optimized)

---

## 📍 Important Constants

```solidity
// Fee
PLATFORM_FEE_BPS = 150        // 1.5% (basis points)

// Market Liquidity
MARKET_LIQUIDITY = 0.01 ether // 10 million wei (0.01 ETH)

// Batching
MAX_BATCH_SIZE = 100          // Max users per batchClaimFor

// Timing
RESOLUTION_BUFFER = 5 minutes // 300 seconds
```

---

## 🔌 Integration Examples

### Using ethers.js v6

#### Setup Contract Instance
```javascript
const { ethers } = require("ethers");

// Connect as signer (for transactions)
const provider = new ethers.JsonRpcProvider(
  "https://base-sepolia.g.alchemy.com/v2/YOUR_API_KEY"
);
const signer = new ethers.Wallet(PRIVATE_KEY, provider);

// Load contract ABI
const PredictionMarketABI = require("./artifacts/contracts/PredictionMarket.sol/PredictionMarket.json").abi;

// Create contract instance
const predictionMarket = new ethers.Contract(
  CONTRACT_ADDRESS,
  PredictionMarketABI,
  signer
);
```

#### Complete Market Lifecycle Flow
```javascript
async function runFullMarketExample() {
  console.log("🎯 Starting Market Lifecycle Demo\n");

  // 1. Fund Liquidity Reserve
  console.log("1️⃣ Funding liquidity reserve...");
  let tx = await predictionMarket.fundLiquidityReserve({
    value: ethers.parseEther("1")
  });
  await tx.wait();
  console.log("✅ Reserve funded with 1 ETH\n");

  // 2. Create Market
  console.log("2️⃣ Creating prediction market...");
  const endTime = Math.floor(Date.now() / 1000) + 86400; // 24 hours
  tx = await predictionMarket.createMarket(
    "Will Ethereum reach $5000 by end of month?",
    Math.floor(Date.now() / 1000) + 3600,  // startTime: 1 hour from now
    endTime,
    ethers.parseEther("0.5"),    // minBet
    ethers.parseEther("10")      // maxBet
  );
  const receipt = await tx.wait();
  console.log("✅ Market created with ID: 1\n");

  // 3. Place Bets
  console.log("3️⃣ Placing bets on market...");
  
  // User 1 bets YES
  tx = await predictionMarket.placeBet(1, true, {
    value: ethers.parseEther("2")
  });
  await tx.wait();
  console.log("✅ User 1 bet 2 ETH on YES");

  // User 2 bets NO
  tx = await predictionMarket.placeBet(1, false, {
    value: ethers.parseEther("3")
  });
  await tx.wait();
  console.log("✅ User 2 bet 3 ETH on NO\n");

  // 4. Check Market Status
  console.log("4️⃣ Checking market details...");
  const market = await predictionMarket.getMarket(1);
  console.log(`📊 Market: "${market.question}"`);
  console.log(`   YES pool: ${ethers.formatEther(market.yesPool)} ETH`);
  console.log(`   NO pool: ${ethers.formatEther(market.noPool)} ETH`);
  console.log(`   Status: ${market.resolved ? "RESOLVED" : "OPEN"}\n`);

  // 5. Check Odds
  console.log("5️⃣ Getting current odds...");
  const [yesOdds, noOdds] = await predictionMarket.getOdds(1);
  console.log(`📈 YES odds: ${(yesOdds / 10000).toFixed(2)}`);
  console.log(`📈 NO odds: ${(noOdds / 10000).toFixed(2)}\n`);

  // 6. Resolve Market (after endTime)
  console.log("6️⃣ Resolving market (YES wins)...");
  // In real scenario, wait for endTime + buffer
  tx = await predictionMarket.resolveMarket(1, true);
  await tx.wait();
  console.log("✅ Market resolved: YES wins!\n");

  // 7. Claim Rewards
  console.log("7️⃣ Claiming rewards...");
  tx = await predictionMarket.claimReward(1);
  await tx.wait();
  console.log("✅ User 1 claimed reward\n");

  // 8. Platform Statistics
  console.log("8️⃣ Final Platform Statistics:");
  const stats = await predictionMarket.getPlatformStats();
  console.log(`💵 Lifetime fees: ${ethers.formatEther(stats[0])} ETH`);
  console.log(`💵 Withdrawn: ${ethers.formatEther(stats[1])} ETH`);
  console.log(`💵 Withdrawable: ${ethers.formatEther(stats[2])} ETH`);
  console.log(`💾 Reserve: ${ethers.formatEther(stats[3])} ETH`);
  console.log(`💰 Contract balance: ${ethers.formatEther(stats[4])} ETH`);
}

// Run example
runFullMarketExample().catch(console.error);
```

#### Error Handling
```javascript
async function placeBetWithErrorHandling(marketId, side, amount) {
  try {
    // Validate inputs
    if (amount <= 0) {
      throw new Error("Bet amount must be positive");
    }

    // Check market exists
    const market = await predictionMarket.getMarket(marketId);
    if (!market.exists) {
      throw new Error(`Market ${marketId} does not exist`);
    }

    // Validate bet range
    if (amount < market.minBet) {
      throw new Error(`Bet below minimum of ${ethers.formatEther(market.minBet)} ETH`);
    }
    if (amount > market.maxBet) {
      throw new Error(`Bet above maximum of ${ethers.formatEther(market.maxBet)} ETH`);
    }

    // Check user hasn't already bet
    const hasUserBet = await predictionMarket.hasUserBet(marketId, signer.address);
    if (hasUserBet) {
      throw new Error("You have already bet on this market");
    }

    // Place the bet
    const tx = await predictionMarket.placeBet(marketId, side, {
      value: ethers.parseEther(amount.toString())
    });

    const receipt = await tx.wait();
    console.log(`✅ Bet placed successfully!`);
    console.log(`   Transaction: ${receipt.hash}`);
    console.log(`   Block: ${receipt.blockNumber}`);

    return receipt;

  } catch (error) {
    console.error("❌ Error placing bet:", error.message);
    throw error;
  }
}
```

---

## 🔒 Security Features

### Smart Contract Security

| Feature | Implementation | Purpose |
|---------|-----------------|---------|
| **ReentrancyGuard** | OpenZeppelin nonReentrant | Prevent reentrancy attacks |
| **Access Control** | Ownable pattern + require() | Authorization checks |
| **Input Validation** | Comprehensive require() statements | Prevent invalid states |
| **Fund Safety** | Low-level call with checks | Safe ETH transfers |
| **Solvency Check** | _checkSolvency() | Protocol remains solvent |

### Best Practices Applied

✅ **Checks-Effects-Interactions Pattern**
- Validate inputs first
- Update state second
- Make external calls last

✅ **Safe Math**
- Solidity ^0.8.19 (built-in overflow protection)
- Carefully ordered operations

✅ **Event Emissions**
- Complete event logging
- Enables off-chain indexing

✅ **Gas Optimization**
- Batch operations support
- Efficient storage writes
- Unchecked loops where safe

---

## 🐛 Troubleshooting

### Common Issues & Solutions

#### ❌ "Insufficient funds for gas"
```
Problem: Transaction reverted due to low ETH balance
Solution: 
  1. Fund wallet from faucet
  2. Use lower gas prices
  3. Check network is correct
```

#### ❌ "Only forwarder" Error
```
Problem: Called onReport() from unauthorized address
Solution:
  1. Verify forwarder address in contract
  2. Use resolveMarket() for manual resolution
  3. Check message sender
```

#### ❌ "Already bet on this market"
```
Problem: User attempted to place second bet
Solution:
  1. Check existing bet: getUserBet()
  2. Claim/refund existing bet first
  3. Then place new bet on different market
```

#### ❌ "Market betting phase has ended"
```
Problem: Bet placed after startTime
Solution:
  1. Check market startTime: getMarket()
  2. Verify block.timestamp
  3. Find open betting market
```

#### ❌ "Market has not ended"
```
Problem: Tried to resolve before endTime
Solution:
  1. Wait for endTime to pass
  2. Add RESOLUTION_BUFFER (5 minutes)
  3. Then call resolveMarket()
```

### Testing During Development

```bash
# Start local node
npx hardhat node

# In another terminal, run tests
npx hardhat test --network localhost

# Deploy locally
npx hardhat run scripts/deploy.js --network localhost

# Interact via console
npx hardhat console --network localhost
```

---

## 📚 Additional Resources

- **Hardhat Documentation**: https://hardhat.org/docs
- **OpenZeppelin Contracts**: https://docs.openzeppelin.com/contracts
- **ethers.js Documentation**: https://docs.ethers.org/v6
- **Ethereum Development**: https://ethereum.org/en/developers
- **Base Network**: https://docs.base.org

---

## 📄 License

MIT License - Copyright (c) 2024

---

<div align="center">

**Built with ❤️ for decentralized prediction markets**

[⬆ back to top](#-harbor-predict---smart-prediction-market-contract)

</div> 