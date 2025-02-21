const { DirectSecp256k1HdWallet, NibiruTxClient } = require('@nibiruchain/nibijs');
const { stringToPath } = require("@cosmjs/crypto");
const { Registry } = require('@cosmjs/proto-signing');
const { defaultRegistryTypes } = require('@cosmjs/stargate');
const { wasmTypes } = require('@cosmjs/cosmwasm-stargate');
require('dotenv').config();
const bip39 = require('bip39');
const { execSync } = require('child_process');

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
        console.log("Wallet created successfully");

        const accounts = await wallet.getAccounts();
        if (accounts.length === 0) {
            throw new Error("No accounts found in the wallet.");
        }

        const firstAccount = accounts[0];
        console.log(`Connected with address: ${firstAccount.address}`);
        console.log(`Account type: ${firstAccount.type || "Not defined"}`);

        // Create registry with CosmWasm support
        const registry = new Registry([
            ...defaultRegistryTypes,
            ...wasmTypes
        ]);

        const client = await NibiruTxClient.connectWithSigner(
            NIBIRU_RPC,
            wallet,
            { 
                prefix: "nibi",
                gasPrice: TX_CONFIG.gasPrices,
                registry // Add the registry here
            }
        );
        console.log("Client connected successfully");
      
        return { client, address: firstAccount.address };
    } catch (error) {
        console.error("Failed to setup client:", error);
        throw error;
    }
}

async function updatePrice(client, sender, tokenId, price) {
    // Use the price string directly without any formatting since it's already in the correct format
    const msg = {
        typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
        value: {
            sender: sender,
            contract: ORACLE_CONTRACT_ADDRESS,
            msg: Buffer.from(JSON.stringify({
                set_price: {
                    token_id: parseInt(tokenId),
                    price_usd: price // Use the price directly from nibid
                }
            })).toString('base64'),
            funds: []
        }
    };
  
    try {
        console.log(`[${new Date().toISOString()}] Updating price for token ${tokenId}`);
        console.log(`Price: ${price} USD`);
        console.log('Message:', JSON.stringify(msg, null, 2));
        
        const result = await client.signAndBroadcast(
            sender,
            [msg],
            {
                amount: [{ denom: "unibi", amount: "750000" }],
                gas: "1000000",
            }
        );
      
        console.log(`Price update successful`);
        console.log(`Transaction Hash: ${result.transactionHash}`);
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

async function fetchAllTokenPairs() {
    try {
        // Use the full path to nibid binary in WSL
        const cmd = 'wsl /root/go/bin/nibid q oracle exchange-rates -o json';
        const result = execSync(cmd).toString();
        const data = JSON.parse(result);
        
        // Create a mapping of pairs to token IDs
        const tokenPairs = {};
        data.exchange_rates.forEach(rate => {
            // Extract base token from pair (e.g., "ubtc" from "ubtc:uusd")
            const baseToken = rate.pair.split(':')[0];
            // Map common tokens to their IDs based on your contract
            switch(baseToken) {
                case 'ubtc':
                    tokenPairs[1] = rate.exchange_rate;
                    break;
                case 'ueth':
                    tokenPairs[2] = rate.exchange_rate;
                    break;
                case 'uatom':
                    tokenPairs[3] = rate.exchange_rate;
                    break;
                case 'uusdc':
                    tokenPairs[4] = rate.exchange_rate;
                    break;
                case 'uusdt':
                    tokenPairs[5] = rate.exchange_rate;
                    break;
            }
        });
        
        return tokenPairs;
    } catch (error) {
        console.error("Error fetching exchange rates:", error);
        // Add more detailed error information
        console.error("Command output:", error.stdout?.toString());
        console.error("Command stderr:", error.stderr?.toString());
        throw error;
    }
}

async function startPriceFeed() {
    console.log("Starting price feed service...");
    console.log(`Update interval: ${UPDATE_INTERVAL}ms (${UPDATE_INTERVAL/3600000} hours)`);
    
    try {
        const { client, address } = await setupClient();

        // Function to update all prices
        const updateAllPrices = async () => {
            try {
                const tokenPrices = await fetchAllTokenPairs();
                
                for (const [tokenId, price] of Object.entries(tokenPrices)) {
                    try {
                        await updatePrice(client, address, parseInt(tokenId), price);
                        console.log(`Updated price for token ${tokenId}: ${price} USD`);
                    } catch (error) {
                        console.error(`Failed to update price for token ${tokenId}:`, error);
                    }
                }
            } catch (error) {
                console.error("Failed to update prices:", error);
            }
        };

        // Initial update
        await updateAllPrices();

        // Schedule recurring updates
        setInterval(updateAllPrices, parseInt(UPDATE_INTERVAL));
  
        console.log("Price feed service started successfully");
    } catch (error) {
        console.error("Failed to start price feed:", error);
        process.exit(1);
    }
}

// Start the price feed
if (require.main === module) {
    const mnemonic = process.env.NIBIRU_MNEMONIC; // Ensure this is set correctly
    const isValid = bip39.validateMnemonic(mnemonic);

    console.log(`Is the mnemonic valid? ${isValid}`);

    startPriceFeed().catch((error) => {
        console.error("Fatal error:", error);
        process.exit(1);
    });
}