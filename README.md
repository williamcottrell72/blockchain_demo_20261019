# Curve Token Factory

Foundry project for a payable factory that deploys user-owned ERC20 tokens with configurable supply caps and bonding-curve metadata.

## Contracts

- `CurveTokenFactory`: users call `createToken` and pay `creationFee`; the factory deploys a new token owned by the caller and stores token/creator history.
- `CurveToken`: minimal ERC20 with owner-only minting, burning, ownership transfer, max-supply enforcement, and a deterministic `quoteMintCost` helper using the stored curve config.

The current bonding curve is intentionally a quote/config surface rather than a full buy/sell market maker. `curveType == 0` quotes a flat price. Any non-zero `curveType` quotes a linear curve using `basePrice` and `slope`.

## Usage

```shell
forge build
forge test
forge fmt
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
