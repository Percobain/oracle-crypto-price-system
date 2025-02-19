const { DirectSecp256k1HdWallet } = require('@nibiruchain/nibijs');
const { SigningCosmWasmClient } = require('@cosmjs/cosmwasm-stargate');
const { stringToPath } = require("@cosmjs/crypto")
require('dotenv').config();

const {
    NIBIRU_MNEMONIC,
    NIBIRU_RPC = "https://rpc.testnet-1.nibiru.fi:443",
    ORACLE_CONTRACT_ADDRESS,
    UPDATE_INTERVAL = "3600000" // 1 hour in milliseconds
} = process.env;

// Configuration matching your manual setup
const TX_CONFIG = {
    chainId: "nibiru-testnet-1",
    gasAdjustment: 1.3,
    gasPrices: "0.025unibi"
};

async function setupClient() {
    try {
        console.log("Setting up client...");
        const wallet = await DirectSecp256k1HdWallet.fromMnemonic(NIBIRU_MNEMONIC, {
            prefix: "nibi",
            hdPaths: [stringToPath("m/44'/118'/0'/0/0")]
        });

        const [firstAccount] = await wallet.getAccounts();
        console.log(`Connected with address: ${firstAccount.address}`);

        const client = await SigningCosmWasmClient.connectWithSigner(
            NIBIRU_RPC,
            wallet,
            { prefix: "nibi" }
        );
        console.log("Client connected successfully");
      
        return { client, address: firstAccount.address };
    } catch (error) {
        console.error("Failed to setup client:", error);
        throw error;
    }
}

async function updatePrice(client, sender, tokenId, price) {
    const msg = {
        set_price: {
            token_id: tokenId,
            price_usd: price
        }
    };
  
    try {
        console.log(`[${new Date().toISOString()}] Updating price for token ${tokenId} to ${price} USD...`);
        const result = await client.execute(
            sender,
            ORACLE_CONTRACT_ADDRESS,
            msg,
            {
                amount: [{ denom: "unibi", amount: "750000" }],
                gas: "auto",
            },
            "Update token price"
        );
      
        console.log(`Price update successful`);
        console.log(`Transaction Hash: ${result.transactionHash}`);
        // Add detailed transaction info
        console.log(`Transaction Details:`);
        console.log(`- Gas Used: ${result.gasUsed}`);
        console.log(`- Gas Wanted: ${result.gasWanted}`);
        console.log(`- Height: ${result.height}`);
        return result;
    } catch (error) {
        console.error(`Failed to update price:`, error);
        throw error;
    }
}

async function fetchLatestPrice(tokenId) {
    // For now hardcoded will add the proper API call later
    return "4500";
}

async function startPriceFeed() {
    console.log("Starting price feed service...");
    console.log(`Update interval: ${UPDATE_INTERVAL}ms (${UPDATE_INTERVAL/3600000} hours)`);
    
    try {
        const { client, address } = await setupClient();
  
        // Immediate first update
        const tokenIds = [1]; // Real estate token ID
        for (const tokenId of tokenIds) {
            const latestPrice = await fetchLatestPrice(tokenId);
            await updatePrice(client, address, tokenId, latestPrice);
        }

        // Schedule recurring updates
        setInterval(async () => {
            try {
                for (const tokenId of tokenIds) {
                    const latestPrice = await fetchLatestPrice(tokenId);
                    await updatePrice(client, address, tokenId, latestPrice);
                }
            } catch (error) {
                console.error("Price feed iteration error:", error);
            }
        }, parseInt(UPDATE_INTERVAL));
  
        console.log("Price feed service started successfully");
    } catch (error) {
        console.error("Failed to start price feed:", error);
        process.exit(1);
    }
}

// Start the price feed
if (require.main === module) {
    startPriceFeed().catch((error) => {
        console.error("Fatal error:", error);
        process.exit(1);
    });
}