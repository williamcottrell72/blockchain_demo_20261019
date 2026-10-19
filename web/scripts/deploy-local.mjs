import {readFile} from "node:fs/promises";
import {createPublicClient, createWalletClient, formatEther, getAddress, http, parseEther} from "viem";
import {foundry} from "viem/chains";

const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const account = getAddress(process.env.DEPLOYER ?? "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
const creationFee = parseEther(process.env.CREATION_FEE_ETH ?? "0.01");

const artifact = JSON.parse(await readFile(new URL("../../out/CurveTokenFactory.sol/CurveTokenFactory.json", import.meta.url)));

const publicClient = createPublicClient({
  chain: foundry,
  transport: http(rpcUrl),
});

const walletClient = createWalletClient({
  account,
  chain: foundry,
  transport: http(rpcUrl),
});

const hash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [creationFee, account],
});

const receipt = await publicClient.waitForTransactionReceipt({hash});
const balance = await publicClient.getBalance({address: account});

console.log(`Factory deployed: ${receipt.contractAddress}`);
console.log(`Owner: ${account}`);
console.log(`Creation fee: ${formatEther(creationFee)} ETH`);
console.log(`Deployer balance: ${formatEther(balance)} ETH`);
