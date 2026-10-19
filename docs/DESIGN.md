# Design Notes

This document explains the intent and current design of the Curve Token Factory project. It is meant to be readable by humans and useful context for future agents.

## Project Purpose

The project demonstrates a simple token factory pattern:

1. A shared factory contract is deployed once.
2. A user pays a small creation fee.
3. The factory deploys a new ERC20 token contract.
4. The user becomes the owner of that token contract.
5. The token stores configuration for a bonding curve.
6. The frontend shows the factory, deployed token contracts, and a form for creating more tokens.

This is intentionally pedagogical. The current contracts are good for learning and local demos, but they are not yet a production launchpad or market maker.

## Main Actors

### Factory Owner

The factory owner is the account that controls factory administration.

The owner can:

- Change `creationFee`.
- Add or remove authorized fee withdrawers.
- Transfer factory ownership.
- Withdraw factory fees.

### Fee Withdrawer

A fee withdrawer is an address authorized by the factory owner.

Fee withdrawers can:

- Withdraw the entire ETH balance from the factory to a chosen payable address.

Fee withdrawers cannot:

- Change the fee.
- Create or edit token configs on behalf of users.
- Take ownership of deployed token contracts.

### Token Creator

The token creator is the caller of `CurveTokenFactory.createToken`.

The creator:

- Pays `creationFee`.
- Chooses token name and symbol.
- Chooses initial supply.
- Chooses bonding-curve config.
- Receives the initial supply.
- Becomes the owner of the newly deployed token.

### Token Owner

The token owner is the OpenZeppelin `Ownable` owner of a particular `CurveToken`.

The token owner can:

- Mint more tokens, subject to `maxSupply`.
- Transfer token ownership.

Any token holder can:

- Transfer tokens.
- Approve spenders.
- Burn their own tokens.

## Contract Architecture

### `CurveTokenFactory`

`CurveTokenFactory` is the deployment and fee-collection contract.

Important state:

- `owner`: factory administrator.
- `creationFee`: ETH required to create a token.
- `tokens`: private array of deployed token addresses.
- `tokenCreator`: mapping from token address to creator address.
- `feeWithdrawer`: mapping of addresses approved to withdraw factory ETH.

Important functions:

- `createToken(...)`: deploys a `CurveToken`, records it, and emits `TokenCreated`.
- `allTokens()`: returns all token addresses.
- `tokenCount()`: returns the number of deployed tokens.
- `tokenAt(index)`: returns a token address by index.
- `setCreationFee(newFee)`: owner-only fee update.
- `setFeeWithdrawer(account, allowed)`: owner-only withdrawal authorization.
- `withdrawFees(to)`: owner-or-withdrawer fee withdrawal.

The factory uses direct deployment with `new CurveToken(...)`. It does not currently use clones, proxies, or create2.

### `CurveToken`

`CurveToken` is an OpenZeppelin ERC20 with ownership and supply controls.

It inherits:

- `ERC20`
- `Ownable`

Important state:

- `FACTORY`: immutable address that deployed the token.
- `bondingCurve`: stored curve configuration.

Important functions:

- `mint(to, amount)`: owner-only minting with cap checks.
- `burn(amount)`: holder burns their own tokens.
- `quoteMintCost(amount)`: returns a deterministic quote based on the stored curve config.

The token uses OpenZeppelin's standard ERC20 behavior for transfers, approvals, allowances, balances, and total supply.

## Bonding Curve Config

The config is:

```solidity
struct BondingCurveConfig {
    uint8 curveType;
    uint256 basePrice;
    uint256 slope;
    uint256 reserveRatioBps;
    uint256 maxSupply;
}
```

### `curveType`

`curveType` selects the quote model.

Current behavior:

- `0`: flat price.
- Any non-zero value: linear price.

This can be extended later to support exponential curves, piecewise curves, sigmoid curves, or reserve-ratio models.

### `basePrice`

`basePrice` is the starting price parameter, denominated in wei-like integer units.

For flat curves, it is the price per token unit.

For linear curves, it is the starting price before the slope adjustment.

### `slope`

`slope` controls how quickly price increases as supply increases.

For the current linear quote:

```text
price_at_supply = basePrice + slope * currentSupply
```

The quote for multiple tokens uses the arithmetic-series sum between the starting and ending marginal prices.

### `reserveRatioBps`

`reserveRatioBps` is stored as basis points, where:

```text
10000 bps = 100%
5000 bps = 50%
1000 bps = 10%
```

The contract validates that `reserveRatioBps <= 10000`.

Important: the current version stores this value for design and UI purposes but does not yet use it in reserve accounting.

### `maxSupply`

`maxSupply` is a mint cap.

- `0` means uncapped.
- Any non-zero value is the maximum allowed total supply.

The cap is checked during initial mint and later owner minting.

## Current Quote Formulas

### Flat Curve

When `curveType == 0`:

```text
quoteMintCost(amount) = basePrice * amount
```

### Linear Curve

When `curveType != 0`:

```text
supply = totalSupply()
startingPrice = basePrice + slope * supply
endingPrice = basePrice + slope * (supply + amount - 1)
quoteMintCost(amount) = (startingPrice + endingPrice) * amount / 2
```

This is the sum of an arithmetic progression. It approximates the total price for minting `amount` sequential units where each next unit becomes more expensive.

## Important Limitation: Quote Surface, Not Market Maker

The current bonding curve is not a full automated market maker.

It does not:

- Accept payment to buy tokens directly from the token contract.
- Hold reserve assets.
- Let users sell tokens back into a reserve.
- Enforce the quoted price during minting.
- Route creator minting through the curve.

Instead, it:

- Stores curve config.
- Exposes `quoteMintCost(amount)`.
- Lets frontends and future contracts read a consistent quote.

This is useful for teaching because it separates two ideas:

1. Token factory and ownership mechanics.
2. Bonding-curve pricing mechanics.

A future version can add real economic settlement after the basic architecture is understood.

## Fee Flow

The factory creation fee is separate from token economics.

Flow:

1. User calls `createToken` and sends ETH.
2. Factory checks `msg.value >= creationFee`.
3. Factory deploys the token.
4. ETH stays in the factory contract.
5. Owner or authorized withdrawer calls `withdrawFees`.
6. Factory sends its full ETH balance to the requested payable address.

The current factory does not refund overpayment. If the user sends more than `creationFee`, the extra ETH remains in the factory and can be withdrawn as fees.

## Frontend Design

The frontend is intentionally lightweight:

- React for UI.
- Vite for dev/build.
- `viem` for chain reads and wallet writes.
- MetaMask or another injected wallet for signing.

The UI has:

- Factory address input.
- RPC URL input.
- Wallet connect button.
- Factory metrics: owner, fee, balance, token count.
- Token creation form.
- Minted token cards.
- Status footer.

The frontend defaults to:

```text
RPC URL: http://127.0.0.1:8545
Chain ID: 31337 through viem's foundry chain
```

The frontend does not deploy the factory. Deployment is handled by scripts and the printed factory address is pasted into the UI.

## Local Scripts

### `npm run deploy:local`

Deploys `CurveTokenFactory` to Anvil using `viem`.

Defaults:

- `RPC_URL=http://127.0.0.1:8545`
- `DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
- `CREATION_FEE_ETH=0.01`

This script uses Anvil's unlocked account behavior, so it does not need a private key.

### `npm run fund:local`

Funds an existing local wallet from a funded Anvil account.

Example:

```shell
TO=0xYourWalletAddress AMOUNT_ETH=10 npm run fund:local
```

Defaults:

- `RPC_URL=http://127.0.0.1:8545`
- `FROM=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
- `AMOUNT_ETH=10`

## Pedagogical Walkthrough

When teaching this project, a useful progression is:

1. Show a normal ERC20 token.
2. Explain token ownership: the owner can mint, users can transfer and burn.
3. Show the factory pattern: one contract deploys many contracts.
4. Explain the creation fee: factory deployment as a paid service.
5. Show the token registry: the factory records what it created.
6. Show the bonding-curve config: token economics as data.
7. Show `quoteMintCost`: deterministic pricing from state.
8. Explain why this is not yet a market maker.
9. Use the frontend to create several tokens with different configs.
10. Compare the token cards and curve parameters.

## Future Design Options

### Full Bonding Curve Market

A full market maker could add:

- `buy(uint256 minTokensOut)` payable function.
- `sell(uint256 tokenAmount, uint256 minEthOut)` function.
- ETH reserve held by the token or a separate pool.
- Buy/sell price formulas.
- Slippage checks.
- Fees on trades.

### Factory-Owned Templates

For cheaper deployment:

- Deploy one implementation contract.
- Use EIP-1167 minimal proxies.
- Initialize each clone with token config.

### Deterministic Addresses

For predictable token addresses:

- Use `CREATE2`.
- Include creator, salt, and token config hash in address derivation.

### Indexing

For a larger app:

- Emit richer events.
- Query events instead of reading `tokenAt` in a loop.
- Use an indexer or subgraph.

### Safer Administration

For production:

- Use OpenZeppelin `Ownable` or `AccessControl` in the factory.
- Add two-step ownership transfer.
- Add withdrawal amount controls.
- Add pause/emergency controls only if truly needed.

## Non-Goals In Current Version

The current version does not aim to provide:

- Audited production security.
- A token launchpad with anti-bot controls.
- Liquidity pools.
- Governance.
- Upgradeability.
- Cross-chain deployment.
- Explorer integration for the local network.

Keeping these out makes the core factory/token/curve ideas easier to inspect and teach.
