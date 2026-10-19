# Project Playbook

This playbook documents how to reproduce a project like this one: a Foundry smart-contract project with a factory that deploys configurable ERC20 contracts, plus a lightweight `viem` frontend for local demos.

It is written for either a human developer or an agent. Follow the steps in order for the smoothest path.

## Goal

Build a local blockchain demo where:

- Users pay a small fee to a factory contract.
- The factory deploys a new ERC20 token contract.
- The caller owns the new ERC20 contract.
- The caller chooses token name, symbol, initial supply, max supply, and bonding-curve config.
- The factory owner or authorized withdrawers can withdraw collected factory fees.
- A frontend can connect to MetaMask, read factory state, display minted token contracts, and call `createToken`.

## Software Needed

Install these tools before starting:

- Git
- Node.js and npm
- Foundry, including `forge`, `cast`, and `anvil`
- MetaMask or another injected browser wallet

Useful version checks:

```shell
node --version
npm --version
forge --version
anvil --version
```

## Representative Starting Prompt

A prompt that can reproduce the initial direction:

```text
Initialize a Foundry project. Build a factory for safe ERC20 contracts where a user can call the factory, pay a small fee, and mint a new ERC20 contract that they own. Let users choose token name, initial circulating supply, and bonding-curve configs. Let the factory owner or authorized addresses withdraw fees. Add tests.
```

A prompt that can reproduce the frontend direction:

```text
Install viem and build a lightweight frontend that shows the main factory contract, a representation of minted token contracts, and buttons/forms to let me mint a contract.
```

A prompt that can reproduce this documentation:

```text
Add a docs playbook describing the setup steps taken so far and a design document explaining the factory, token, bonding curve, and frontend design for humans and agents.
```

## Repository Setup

Create or enter the repo:

```shell
mkdir blockchain_demo
cd blockchain_demo
git init
```

Initialize Foundry:

```shell
forge init --force --no-git
```

Install dependencies:

```shell
forge install OpenZeppelin/openzeppelin-contracts
npm init -y
npm install viem react react-dom lucide-react vite typescript @vitejs/plugin-react @types/react @types/react-dom
```

In this repo, `forge-std` is used for tests and OpenZeppelin Contracts is used for the ERC20 and Ownable implementations.

## Contract Files

Create these main contract files:

- `src/CurveToken.sol`
- `src/CurveTokenFactory.sol`

The token contract should:

- Inherit OpenZeppelin `ERC20`.
- Inherit OpenZeppelin `Ownable`.
- Store a `BondingCurveConfig`.
- Mint the initial supply to the token owner.
- Allow only the token owner to mint more.
- Let holders burn their own tokens.
- Enforce `maxSupply` when non-zero.
- Expose `quoteMintCost(amount)` for flat and linear pricing.

The factory contract should:

- Store an owner.
- Store `creationFee`.
- Deploy new `CurveToken` contracts from `createToken`.
- Require `msg.value >= creationFee`.
- Track all deployed tokens in an array.
- Track `tokenCreator[token]`.
- Let the owner change the creation fee.
- Let the owner add or remove fee withdrawers.
- Let owner or fee withdrawers withdraw the factory ETH balance.

## Test Coverage

Create `test/CurveTokenFactory.t.sol`.

Important tests:

- Creating a token collects the fee.
- Creating a token assigns token ownership to the caller.
- Creating a token stores factory token history.
- Creation reverts if the fee is too low.
- Owner can authorize a fee withdrawer.
- Unauthorized addresses cannot withdraw fees.
- Token owner can mint within cap.
- Token owner cannot mint above cap.
- `quoteMintCost` uses the configured curve.

Run:

```shell
forge test
```

This repo sets `offline = true` in `foundry.toml` because this local macOS environment hit a Foundry proxy/signature lookup panic when Foundry tried to reach remote services. Offline mode keeps local tests predictable.

## Frontend Files

Create a Vite frontend with:

- `index.html`
- `vite.config.ts`
- `tsconfig.json`
- `web/src/main.tsx`
- `web/src/abi.ts`
- `web/src/styles.css`
- `web/src/vite-env.d.ts`

The frontend should:

- Let the user enter a factory address.
- Let the user enter an RPC URL, defaulting to `http://127.0.0.1:8545`.
- Connect to an injected wallet such as MetaMask.
- Read factory `owner`, `creationFee`, `tokenCount`, and ETH balance.
- Read each token using `tokenAt(index)`.
- Read each token's creator, name, symbol, owner, total supply, and curve config.
- Show a form for name, symbol, initial supply, max supply, curve type, reserve bps, base price, and slope.
- Call `createToken` through the connected wallet with `value = creationFee`.

Useful commands:

```shell
npm run dev
npm run build:web
```

## Local Chain Setup

Start Anvil:

```shell
anvil --host 127.0.0.1 --port 8545 --chain-id 31337
```

Anvil prints funded local accounts. The default account used in this repo is:

```text
Address:
0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

Private key:
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

This is a public local-development key. Never use it outside local testing.

## Local Deployment

Foundry script deployment is available:

```shell
CREATION_FEE=10000000000000000 \
INITIAL_OWNER=0xYourOwnerAddress \
forge script script/DeployCurveTokenFactory.s.sol:DeployCurveTokenFactory \
  --rpc-url http://127.0.0.1:8545 \
  --private-key <private_key> \
  --broadcast
```

In this environment, `forge script` hit a Foundry proxy panic while talking to Anvil, so this repo also includes a `viem` deploy helper:

```shell
npm run deploy:local
```

Environment variables:

```shell
RPC_URL=http://127.0.0.1:8545
DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
CREATION_FEE_ETH=0.01
```

The deploy script prints:

- Factory address
- Owner address
- Creation fee
- Deployer balance

Paste the printed factory address into the frontend.

## MetaMask Setup

Add a custom network:

```text
Network name: Anvil Local
Default RPC URL: http://127.0.0.1:8545
Chain ID: 31337
Currency symbol: ETH
Block explorer URL:
```

Leave block explorer blank.

MetaMask may suggest another currency symbol for chain `31337`; for this local Anvil setup, `ETH` is the expected symbol.

Import the Anvil account above, or fund an existing wallet.

## Funding a Wallet

If you import the default Anvil private key, it already has test ETH.

To fund an existing wallet address from the default Anvil account:

```shell
TO=0xYourWalletAddress AMOUNT_ETH=10 npm run fund:local
```

Optional environment variables:

```shell
RPC_URL=http://127.0.0.1:8545
FROM=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
TO=0xYourWalletAddress
AMOUNT_ETH=10
```

## Demo Flow

1. Start Anvil.
2. Run `npm run deploy:local`.
3. Run `npm run dev`.
4. Open `http://127.0.0.1:5173/`.
5. Add and select the Anvil Local network in MetaMask.
6. Connect MetaMask.
7. Paste the factory address printed by `deploy:local`.
8. Click refresh.
9. Fill out the token creation form.
10. Submit `Create Token` and confirm in MetaMask.
11. After the transaction confirms, the new token appears under minted contracts.

## Current Verification Commands

Run these before handing off:

```shell
forge test
npm run build:web
```

Expected current result:

- Foundry tests pass.
- Web build passes.
- Vite may warn that a JavaScript chunk is larger than 500 kB because `viem` is bundled.

## Suggested Next Improvements

- Add a real buy/sell reserve contract around the bonding curve.
- Use create2 for deterministic token addresses.
- Add events/indexing for frontend reads at larger scale.
- Add token owner controls for metadata or curve settings, if desired.
- Replace local ABI copies with generated ABI imports from Foundry artifacts.
- Add wallet network-switch helpers in the frontend.
