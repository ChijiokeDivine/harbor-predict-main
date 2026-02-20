
const hre = require("hardhat");
require("dotenv").config();

async function main() {
  // Validate environment variables
  if (!process.env.PRIVATE_KEY) {
    throw new Error("❌ PRIVATE_KEY not set in .env file");
  }

  // Get wallet and provider
  const provider = hre.ethers.provider;
  const wallet = new hre.ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log("ℹ️ Deploying from address:", wallet.address);
  console.log("ℹ️ Network:", hre.network.name);

  // Check account balance
  const balance = await provider.getBalance(wallet.address);
  console.log("ℹ️ Account balance:", hre.ethers.formatEther(balance), "ETH");

  if (hre.ethers.parseEther("0.01") > balance) {
    throw new Error("❌ Insufficient balance for deployment");
  }

  // Get contract factory
  const PredictionMarketFactory = await hre.ethers.getContractFactory("PredictionMarket", wallet);

  // Optional: Set custom gas settings (uncomment to use)
  // const gasPrice = hre.ethers.parseUnits("20", "gwei");
  // const deployTx = await PredictionMarketFactory.deploy({ gasPrice });
  
  // Deploy contract
  console.log("⏳ Deploying PredictionMarket...");
  const predictionMarket = await PredictionMarketFactory.deploy();

  // Wait for deployment to be mined
  const receipt = await predictionMarket.waitForDeployment();
  const contractAddress = receipt.target;

  console.log("✅ PredictionMarket deployed to:", contractAddress);
  console.log("ℹ️ Transaction hash:", receipt.deploymentTransaction().hash);

  // Verify contract on Etherscan (if on a supported network and API key is provided)
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost" && process.env.ETHERSCAN_API_KEY) {
    console.log("⏳ Verifying contract on Etherscan...");
    try {
      await hre.run("verify:verify", {
        address: contractAddress,
        constructorArguments: [],
      });
      console.log("✅ Contract verified on Etherscan");
    } catch (error) {
      console.error("⚠️ Verification failed:", error.message);
    }
  } else {
    console.log("ℹ️ Skipping verification (local network or no ETHERSCAN_API_KEY)");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error deploying contract:", error.message);
    process.exit(1);
  });
