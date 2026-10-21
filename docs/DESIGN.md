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

- Change `creationFee` and `upgradeabilityFee`.
- Change the implementation used by future upgradeable tokens (not existing ones).
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
- For upgradeable tokens only: change the curve parameters and upgrade the token's logic.

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
- `createUpgradeableToken(...)`: charges `creationFee + upgradeabilityFee`, deploys an `ERC1967Proxy` pointing at `upgradeableImplementation`, initializes it, records it, and emits `TokenCreated` plus `UpgradeableTokenCreated`.
- `allTokens()`: returns all token addresses.
- `tokenCount()`: returns the number of deployed tokens.
- `tokenAt(index)`: returns a token address by index.
- `setCreationFee(newFee)`: owner-only fee update.
- `setFeeWithdrawer(account, allowed)`: owner-only withdrawal authorization.
- `withdrawFees(to)`: owner-or-withdrawer fee withdrawal.

Fixed tokens use direct deployment with `new CurveToken(...)`. Upgradeable tokens use UUPS proxies (see below). The factory does not use clones or create2.

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
- `mintFromCurve(amount)`: public payable minting at the current quoted curve cost.
- `withdrawProceeds(to)`: owner-only withdrawal of ETH collected by curve mints.
- `burn(amount)`: holder burns their own tokens.
- `quoteMintCost(amount)`: returns a deterministic quote based on the stored curve config.

The token uses OpenZeppelin's standard ERC20 behavior for transfers, approvals, allowances, balances, and total supply.

### `CurveTokenUpgradeable` and the UUPS Proxy Pattern

A normal contract's code is fixed when it is deployed. A proxy splits one contract into two:

```text
user ──call──▶ ERC1967Proxy (storage, ETH, address) ──delegatecall──▶ CurveTokenUpgradeable (code only)
```

- The **proxy** is the token address users see. It holds balances, the curve config, the owner, and ETH. Its only job is to forward every call with `delegatecall`, which runs the implementation's code against the proxy's own storage.
- The **implementation** holds only code. One implementation is shared by every upgradeable token the factory creates.
- The implementation address is stored in a fixed slot defined by ERC-1967 (`keccak256("eip1967.proxy.implementation") - 1`), chosen so it cannot collide with normal state variables. The frontend reads this slot directly with `eth_getStorageAt` to show which logic each token runs.

**UUPS** (Universal Upgradeable Proxy Standard, ERC-1822) puts the upgrade function, `upgradeToAndCall`, in the *implementation* instead of the proxy. That keeps the proxy tiny (~160 bytes of runtime code), and the implementation decides who may upgrade through `_authorizeUpgrade`. In this project only the token owner may upgrade. The factory owner cannot upgrade a user's token.

Proxy-specific rules the contract follows:

- **No constructor setup.** The proxy never runs the implementation's constructor, so setup lives in `initialize`, which the factory calls atomically when it deploys the proxy. The `initializer` modifier makes it callable only once.
- **Lock the implementation.** The implementation's constructor calls `_disableInitializers()`, so nobody can initialize the bare implementation contract and claim it.
- **No `immutable` per-token values.** Immutables live in code, not storage, so the factory address is a normal state variable (`factory`) here instead of `FACTORY`.
- **Append-only storage.** A future version must keep the existing state variable order and only add new variables after them. Reordering would make the new code read old data from the wrong slots. OpenZeppelin's upgradeable parents use namespaced (ERC-7201) storage, so their state does not collide with ours.
- **Forget the upgrade function and the token is frozen for good.** If a new implementation left out `UUPSUpgradeable`, the proxy could never be upgraded again.

Upgradeable tokens add two owner-only capabilities:

- `updateBondingCurve(config)`: change the curve type, prices, reserve ratio, and cap. The cap cannot drop below current supply. This is what the frontend's **Modify** button calls.
- `upgradeToAndCall(newImplementation, data)`: replace the logic entirely while keeping balances and settings. `test/CurveTokenUpgradeable.t.sol` shows this with a `CurveTokenUpgradeableV2` that reports `version() == 2` and keeps all state.

Trade-off to teach: upgradeability is power held by the owner. Holders of an upgradeable token are trusting the owner not to change prices or logic against them. That is why the fixed `CurveToken` stays the default, and why upgradeability costs an extra fee here. Production systems usually put upgrade rights behind a multisig and/or timelock.

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

## Important Limitation: Minting Curve, Not Full Market Maker

The current bonding curve supports paid public minting, but it is not a full automated market maker.

It does:

- Store curve config.
- Expose `quoteMintCost(amount)`.
- Let buyers call `mintFromCurve(amount)` and pay exactly the quoted ETH cost.
- Hold those ETH proceeds in the token contract.
- Let the token owner withdraw proceeds.

It does not:

- Let users sell tokens back into a reserve.
- Use `reserveRatioBps` for reserve accounting yet.
- Provide slippage controls.
- Route owner minting through the curve.

This is useful for teaching because it separates two ideas:

1. Token factory and ownership mechanics.
2. Bonding-curve pricing and paid minting mechanics.

A future version can add sell-side settlement and real reserve accounting after the basic architecture is understood.

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
- Factory metrics: owner, owner balance, fee, upgrade fee, balance, token count.
- An "Upgradeable (UUPS proxy)" checkbox on the create form.
- A Modify button per token card, enabled only for upgradeable tokens owned by the connected wallet.
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
8. Show `mintFromCurve`: a different wallet pays the quote and receives new tokens.
9. Explain why this is still not a full buy/sell market maker.
10. Use the frontend to create several tokens with different configs.
11. Compare the token cards and curve parameters.
12. Create an upgradeable token and compare its "Contract" and "Logic" fields to a fixed one.
13. Use **Modify** on the upgradeable token to change its price, then re-quote a mint. Note that the token address did not change.
14. Walk through `testOwnerCanUpgradeAndStateIsPreserved` to show that logic can be swapped out while the data stays in place.

## General Smart Contract Principles

These principles should guide future changes. Some are already present in this demo; others become more important as the system grows toward production.

### Checks-Effects-Interactions

Use the checks-effects-interactions pattern whenever a function changes state and calls outside the contract.

Order function logic as:

1. Checks: validate inputs, permissions, balances, caps, and other preconditions.
2. Effects: update internal contract state.
3. Interactions: call external contracts or send ETH last.

This ordering reduces reentrancy risk because the contract's own state is already settled before control leaves the contract.

In this project, `withdrawFees` follows the spirit of this pattern by checking authorization before sending ETH. If fee accounting becomes more granular later, update internal accounting before making the external call.

### Pull Payments Over Push Payments

Prefer pull-based payment flows when many users may receive funds.

Instead of automatically sending ETH or tokens to recipients during an unrelated state change, record what they are owed and let them call a separate withdrawal function. This avoids denial-of-service failures where one recipient contract rejects payment and causes the whole operation to revert.

The current factory has a simple admin withdrawal flow, not per-user payment distribution. A future bonding-curve market with refunds, creator revenue, or sell proceeds should use pull payments for user balances.

### Role-Based Access Control

Single-owner administration is simple and useful for teaching, but production contracts often need more granular permissions.

Role-based access control separates capabilities such as:

- `DEFAULT_ADMIN_ROLE`: manages roles.
- `MINTER_ROLE`: mints tokens.
- `PAUSER_ROLE`: pauses emergency-sensitive flows.
- `WITHDRAWER_ROLE`: withdraws fees or protocol revenue.

This project currently uses a simple `owner` plus `feeWithdrawer` mapping. A production version could replace that with OpenZeppelin `AccessControl` if permissions become more complex.

### Factory Pattern

Use a factory when one contract should create and track many related child contracts.

The factory gives the system:

- A single public entry point.
- A registry of deployed child contracts.
- Shared fee and admin policy.
- Consistent deployment parameters.

This project uses the factory pattern directly: `CurveTokenFactory` deploys many `CurveToken` child contracts and records each token address and creator.

### Transient Storage

Transient storage, introduced by EIP-1153, provides temporary transaction-scoped storage through `TSTORE` and `TLOAD`.

It can reduce gas for patterns such as reentrancy guards because data written to transient storage is cleared automatically at the end of the transaction and does not pay the same cost profile as permanent storage.

Use transient storage only when the target chain supports it and the team is comfortable with the newer execution semantics. The current demo does not need it, but a production bonding-curve market with frequent external calls could consider transient-storage reentrancy guards where supported.

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
- Cross-chain deployment.
- Explorer integration for the local network.

Keeping these out makes the core factory/token/curve ideas easier to inspect and teach.
