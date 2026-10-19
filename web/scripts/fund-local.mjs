import {createPublicClient, createWalletClient, formatEther, getAddress, http, parseEther} from "viem";
import {foundry} from "viem/chains";

const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const from = getAddress(process.env.FROM ?? "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
const to = process.env.TO ? getAddress(process.env.TO) : null;
const amount = parseEther(process.env.AMOUNT_ETH ?? "10");

if (!to) {
  console.error("Set TO=0xYourWalletAddress to fund a local wallet.");
  process.exit(1);
}

const publicClient = createPublicClient({
  chain: foundry,
  transport: http(rpcUrl),
});

const walletClient = createWalletClient({
  account: from,
  chain: foundry,
  transport: http(rpcUrl),
});

const hash = await walletClient.sendTransaction({
  to,
  value: amount,
});

await publicClient.waitForTransactionReceipt({hash});
const balance = await publicClient.getBalance({address: to});

console.log(`Funded ${to} with ${formatEther(amount)} ETH`);
console.log(`Balance: ${formatEther(balance)} ETH`);
