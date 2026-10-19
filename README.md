# Curve Token Factory

Foundry project for a payable factory that deploys user-owned ERC20 tokens with configurable supply caps and bonding-curve metadata.

## Contracts

- `CurveTokenFactory`: users call `createToken` and pay `creationFee`; the factory deploys a new token owned by the caller and stores token/creator history.
- `CurveToken`: minimal ERC20 with owner-only minting, burning, ownership transfer, max-supply enforcement, and a deterministic `quoteMintCost` helper using the stored curve config.

The current bonding curve is intentionally a quote/config surface rather than a full buy/sell market maker. `curveType == 0` quotes a flat price. Any non-zero `curveType` quotes a linear curve using `basePrice` and `slope`.

## Docs

- [Project Playbook](docs/PLAYBOOK.md): step-by-step reproduction guide for humans or agents.
- [Design Notes](docs/DESIGN.md): pedagogical explanation of the contracts, bonding curve model, frontend, and future design options.

## Usage

```shell
forge build
forge test
forge fmt
npm run dev
npm run deploy:local
```

This project sets Foundry `offline = true` because local `forge test` was otherwise invoking remote selector lookup on this machine. If you need Foundry to download a new Solidity compiler or fetch remote data, temporarily pass `--no-auto-detect` with an installed compiler or remove offline mode.

## Deploy

```shell
CREATION_FEE=10000000000000000 \
INITIAL_OWNER=0xYourOwnerAddress \
forge script script/DeployCurveTokenFactory.s.sol:DeployCurveTokenFactory \
  --rpc-url <your_rpc_url> \
  --private-key <your_private_key> \
  --broadcast
```

If `INITIAL_OWNER` is not set, the deploy script uses the broadcasting sender. If `CREATION_FEE` is not set, it defaults to `0.01 ether`.

## Frontend

```shell
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`, connect a wallet, enter the deployed factory address, and refresh the factory state. The app reads the factory fee, owner, balance, token count, and each minted token contract, then sends `createToken` transactions through the connected wallet.

For a local demo:

```shell
anvil --host 127.0.0.1 --port 8545 --chain-id 31337
npm run deploy:local
```

If you want to fund an existing wallet on Anvil:

```shell
TO=0xYourWalletAddress AMOUNT_ETH=10 npm run fund:local
```
