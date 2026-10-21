# Project Playbook

This playbook shows how to rebuild this project step by step, in the order it was actually developed. The project is a Foundry smart-contract repo with a factory that deploys configurable ERC20 tokens, plus a lightweight `viem` + React frontend for local demos.

Each phase has:

- **Prompt**: a cleaned-up version of the request used during development. Give it to a coding agent as written, or treat it as a spec if you are building by hand.
- **What you should end up with**: the files and behavior the phase produces.
- **Checkpoint**: commands to run before moving on.
- **Lessons learned**: problems hit during the original build, folded back in so you can skip them.

## How to Use This Playbook With Claude

1. Create an empty git repo that contains only this file at `docs/PLAYBOOK.md`.
2. Install the [prerequisites](#prerequisites).
3. Open Claude Code in the repo root.
4. Paste each phase's **Prompt** block in order. Wait for the phase to finish, run its **Checkpoint**, then commit and tag before pasting the next prompt:

   ```shell
   git add -A && git commit -m "Phase 1: factory and fixed token" && git tag phase-1
   ```

Each prompt already includes the fixes from that phase's lessons learned. The lessons are listed separately so you understand *why* the prompt asks for those things. Exact code will differ from the original repo; behavior, tests, and UI should match.

The order is deliberate. The tokens start out **non-upgradeable**, and upgradeability is added only in Phase 6. That way you can compare a fixed contract with a proxy-based one side by side and see exactly what the proxy pattern changes.

For the reasoning behind the contracts, see [DESIGN.md](DESIGN.md).

## Prerequisites

Install:

- Git
- Node.js 22+ and npm
- Foundry (`forge`, `cast`, `anvil`)
- MetaMask or another injected browser wallet

Check versions:

```shell
node --version
npm --version
forge --version
anvil --version
```

Tip: commit and tag the end of every phase (`git tag phase-1`, and so on). The git history then becomes a teaching aid; for example, `git diff phase-5 phase-6` shows exactly what upgradeability adds.

---

## Phase 1: Factory and Fixed ERC20 Token

**Prompt**

```text
Initialize a Foundry project in this repo (keep docs/PLAYBOOK.md) and install
OpenZeppelin Contracts pinned to v5.7.0. Set offline = true in foundry.toml.
Build:

1. CurveToken: an ERC20 + Ownable token. The constructor takes name, symbol,
   owner, initial supply, and a BondingCurveConfig struct
   {curveType, basePrice, slope, reserveRatioBps, maxSupply}. Mint the initial
   supply to the owner. The owner can mint more; holders can burn their own
   tokens. Enforce maxSupply when it is non-zero, and reject reserveRatioBps
   above 10000. Add quoteMintCost(amount): curveType 0 is a flat price; any
   other value is linear (arithmetic-series sum from the current supply).

2. CurveTokenFactory: users call createToken(...) and pay at least creationFee.
   The factory deploys a CurveToken owned by the caller and records every
   token address and its creator. The factory owner can change the fee,
   add or remove fee withdrawers, and transfer ownership. The owner or an
   authorized withdrawer can withdraw collected fees.

Use custom errors and emit events for every state change. Add a deploy script
(fee and owner configurable by env var) and Foundry tests covering the
happy paths and the access-control and fee failures. Make sure forge test passes.
```

**What you should end up with**

- `src/CurveToken.sol`, `src/CurveTokenFactory.sol`
- `script/DeployCurveTokenFactory.s.sol`
- `test/CurveTokenFactory.t.sol`, testing that:
  - token creation collects the fee and gives ownership to the caller
  - token history is stored
  - an underpaid creation reverts with `FeeTooLow`
  - fee-withdrawer authorization works, and unauthorized addresses can't withdraw
  - owner minting works within the cap and reverts above it
  - `quoteMintCost` matches the configured curve

Setup commands:

```shell
forge init --force --no-git
forge install OpenZeppelin/openzeppelin-contracts@v5.7.0
```

**Checkpoint**

```shell
forge build
forge test
```

**Lessons learned**

- Set `offline = true` in `foundry.toml`. On this macOS machine, Foundry crashed during `forge test` while trying a remote selector lookup.

---

## Phase 2: Frontend and Local Chain Scripts

**Prompt**

```text
Install viem, React, Vite, TypeScript, and lucide-react, and build a
lightweight single-page frontend in web/src for the factory. It should:

- Take a factory address and RPC URL (default http://127.0.0.1:8545),
  remembering both in localStorage.
- Connect to an injected wallet (MetaMask).
- Show factory metrics: owner, fee, factory ETH balance, token count.
- List every minted token as a card: name, symbol, address, supply, cap,
  creator, owner, curve type, reserve bps.
- Offer a form (name, symbol, initial supply, max supply, curve type,
  reserve bps, base price, slope) that calls createToken with the fee.
- Show a status bar for pending, success, and error states.

Keep the contract ABIs in web/src/abi.ts as typed `as const` excerpts.
Also add npm scripts that use viem against Anvil's unlocked accounts:
deploy:local (reads the factory artifact from out/, deploys it, and prints
its address, owner, and fee) and fund:local (sends test ETH to a given
wallet). Use viem for deployment rather than forge script. Make sure
npm run build:web passes.
```

**What you should end up with**

- `index.html`, `vite.config.ts`, `tsconfig.json`
- `web/src/main.tsx`, `web/src/abi.ts`, `web/src/styles.css`, `web/src/vite-env.d.ts`
- `web/scripts/deploy-local.mjs`, `web/scripts/fund-local.mjs`
- `package.json` scripts: `dev`, `build:web`, `deploy:local`, `fund:local`

Install command:

```shell
npm init -y
npm install viem react react-dom lucide-react vite typescript @vitejs/plugin-react @types/react @types/react-dom
```

**Checkpoint**

```shell
npm run build:web
anvil --host 127.0.0.1 --port 8545 --chain-id 31337   # separate terminal
npm run deploy:local
npm run dev
```

Paste the printed factory address into the app and create a token. See [Running the Demo](#running-the-demo).

**Lessons learned**

- `forge script` crashed with a Foundry internal error while talking to Anvil in this environment. The viem deploy helper avoids it, and since Anvil's accounts are unlocked it needs no private key.
- The ABI in `web/src/abi.ts` is a hand-copied excerpt of the compiled ABI. Whenever a contract function changes, update it too.

---

## Phase 3: Documentation

**Prompt**

```text
Add docs/DESIGN.md explaining the factory, token, bonding-curve math,
fee flow, and frontend for both humans and agents. Be explicit about what
the bonding curve does not do yet. Update the README with usage, deploy, and
frontend instructions, and link docs/DESIGN.md and docs/PLAYBOOK.md.
Do not rewrite docs/PLAYBOOK.md.
```

**What you should end up with**

- `docs/DESIGN.md` and an updated README. (In the original build, this phase also wrote the playbook you are reading.)

---

## Phase 4: Clear Errors on Token Creation

**Prompt**

```text
Token creation sometimes fails in the UI with an unhelpful message. Before
sending a transaction, simulate it with publicClient.simulateContract so
reverts are caught before the wallet prompt. Check client-side that max supply
is at least initial supply. After sending, check receipt.status and report
reverted transactions. Add the contracts' custom error definitions to
web/src/abi.ts, and make the UI's error helper append the decoded error name
(from viem's ContractFunctionRevertedError) so users see e.g. "FeeTooLow"
instead of a raw selector. In DESIGN.md, add a "General Smart Contract
Principles" section covering checks-effects-interactions, pull vs. push
payments, role-based access control, the factory pattern, and transient
storage.
```

**What you should end up with**

- Every write follows the same three steps: **simulate → write → wait for the receipt and check its status**. Later phases reuse this pattern.
- A principles section in `DESIGN.md`.

**Lessons learned**

- Without the error entries in `abi.ts` and the decoding in the helper, users see "reverted with the following signature: 0x…" instead of `FeeTooLow` or `OwnableUnauthorizedAccount`. In the original build this was only fixed in Phase 6.

---

## Phase 5: Paid Minting From the Curve and a Fee-Withdraw UI

**Prompt**

```text
Make the bonding curve usable, not just quotable:

- Add CurveToken.mintFromCurve(amount): anyone can call it, paying exactly
  quoteMintCost(amount) in ETH (revert IncorrectPayment otherwise), and it
  mints within the cap. Keep the ETH in the token contract.
- Add an owner-only withdrawProceeds(to) for that ETH.
- In the UI, give each token card a "Mint Amount" input with a live cost
  quote, a Mint Tokens button, and the token's ETH proceeds and the connected
  wallet's balance.
- Add an "Owner Balance" metric and a Fee Admin band with a Withdraw Fees
  button that withdraws factory fees to the connected wallet.
- Add tests for exact-payment minting, wrong-payment reverts, and
  proceeds withdrawal. In tests, compute the quote before vm.prank, since a
  nested call would use up the prank. Update DESIGN.md and the README: the
  curve now supports paid minting but is still not a full buy/sell market
  maker.
```

**What you should end up with**

- A second wallet can buy tokens from the curve, and the creator can withdraw the proceeds.
- `CurveToken` is still a fixed contract: its curve can never change after deployment.

**Checkpoint**

```shell
forge test
npm run build:web
```

**Commit here.** This is the non-upgradeable baseline that Phase 6 is compared against.

---

## Phase 6: Upgradeable Tokens With UUPS Proxies

**Prompt**

```text
Illustrate upgradeable proxy contracts. Keep the fixed CurveToken as the
default, and let users pay an extra fee to mint an upgradeable token instead,
using the UUPS (Universal Upgradeable Proxy Standard) pattern:

- Install openzeppelin-contracts-upgradeable at the same version as
  openzeppelin-contracts (v5.7.0). In v5.7, Initializable and
  UUPSUpgradeable come from the core package (@openzeppelin/contracts/proxy/utils);
  take only ERC20Upgradeable and OwnableUpgradeable from the upgradeable one.
- Add CurveTokenUpgradeable: the same behavior as CurveToken, but
  initializer-based (ERC20Upgradeable, OwnableUpgradeable, UUPSUpgradeable).
  Its constructor must call _disableInitializers(). Only the token owner may
  upgrade (_authorizeUpgrade) or call updateBondingCurve(config), which
  rejects reserve > 10000 bps and a cap below current supply. Add a version()
  function. Use a storage variable for the factory address (no immutables
  behind a proxy).
- Factory: add upgradeabilityFee (as a constructor argument), deploy one
  shared implementation in the constructor, and add
  createUpgradeableToken(...), which requires creationFee + upgradeabilityFee
  and deploys an ERC1967Proxy that is initialized in the same transaction.
  Track isUpgradeable[token]. The owner can change the fee and the
  implementation used by future tokens; existing tokens can only be upgraded
  by their own owner.
- Tests: proxy initialization, the extra fee, owner-only modify and upgrade,
  the factory owner cannot upgrade user tokens, re-initialization blocked on
  the proxy and the implementation, and an upgrade to a V2 mock that keeps
  balances, ETH, and settings. Update the existing tests for the new
  factory constructor. Make sure forge test passes and check sizes with
  forge build --sizes.
- Frontend: an "Upgradeable (UUPS proxy)" checkbox that shows the total cost
  on the Create button. Each token card shows Contract (Fixed / UUPS Proxy)
  and Logic (version + implementation address, read from the ERC-1967
  storage slot). Add a Modify button that is enabled only for upgradeable
  tokens owned by the connected wallet (greyed out with an explanatory
  tooltip otherwise). It opens an inline editor for the curve parameters
  and calls updateBondingCurve. Share one curve-fields component between
  the create form and the editor. Add an "Upgrade Fee" metric. Update
  deploy-local and the deploy script for the new constructor argument
  (UPGRADEABILITY_FEE_ETH / UPGRADEABILITY_FEE, default 0.005 ETH).
- Docs: explain proxies, delegatecall, the ERC-1967 slot, UUPS, and the
  storage-layout rules in DESIGN.md, plus the trust trade-off of upgradeable
  tokens. Update the README. Do not rewrite docs/PLAYBOOK.md.
```

**What you should end up with**

- `src/CurveTokenUpgradeable.sol` and `test/CurveTokenUpgradeable.t.sol`
- The factory constructor is now `(creationFee, initialOwner, upgradeabilityFee)`. The deploy scripts accept `UPGRADEABILITY_FEE` / `UPGRADEABILITY_FEE_ETH` (default 0.005 ETH).
- In the UI, fixed and proxy tokens appear side by side; only the proxy's owner can modify its curve.

Install command:

```shell
forge install OpenZeppelin/openzeppelin-contracts-upgradeable@v5.7.0
```

**Checkpoint**

```shell
forge test
npm run build:web
npm run deploy:local   # redeploy: the constructor changed
```

Then go through [Demo Flow](#demo-flow), steps 9 to 13.

**Lessons learned**

- In OpenZeppelin v5.7, `Initializable` and `UUPSUpgradeable` come from the core package (`@openzeppelin/contracts/proxy/utils/...`). The upgradeable package only re-exports them. Use the upgradeable package just for `ERC20Upgradeable` and `OwnableUpgradeable`.
- Keep the two OpenZeppelin packages on the **same version**. The upgradeable package compiles against the core one through the `@openzeppelin/contracts/` remapping.
- An implementation behind a proxy can't use `immutable` per-token values (those live in code, not storage), so `FACTORY` becomes a storage variable `factory`.
- A Foundry gotcha: `vm.prank(buyer); token.mintFromCurve{value: token.quoteMintCost(3)}(3);` mints as the test contract, not the buyer, because the nested `quoteMintCost` call uses up the prank. Compute the cost on its own line first.
- Deploying the implementation inside the factory constructor keeps deployment to one step and is well within contract size limits. Check with `forge build --sizes`.

---

## Running the Demo

### Local Chain

```shell
anvil --host 127.0.0.1 --port 8545 --chain-id 31337
```

Anvil's first account is the default deployer:

```text
Address:     0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Private key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

This is a public development key. Never use it outside local testing. Restarting Anvil wipes the chain, so you must redeploy afterwards.

### Deploying the Factory

```shell
forge build            # deploy-local reads the compiled contract from out/
npm run deploy:local
```

Optional environment variables:

```shell
RPC_URL=http://127.0.0.1:8545
DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
CREATION_FEE_ETH=0.01
UPGRADEABILITY_FEE_ETH=0.005
```

The script prints the factory address, the owner, both fees, and the deployer's balance. The deployer becomes the factory owner. The factory address depends on how many transactions the deployer has already sent, so always copy it from the output.

The Foundry script also works on networks where `forge script` behaves:

```shell
CREATION_FEE=10000000000000000 \
UPGRADEABILITY_FEE=5000000000000000 \
INITIAL_OWNER=0xYourOwnerAddress \
forge script script/DeployCurveTokenFactory.s.sol:DeployCurveTokenFactory \
  --rpc-url http://127.0.0.1:8545 \
  --private-key <private_key> \
  --broadcast
```

### MetaMask

Add a custom network:

```text
Network name:    Anvil Local
RPC URL:         http://127.0.0.1:8545
Chain ID:        31337
Currency symbol: ETH
Block explorer:  (leave blank)
```

MetaMask may suggest a different currency symbol for chain `31337`. Use `ETH`.

Import the Anvil key above, or fund an existing wallet:

```shell
TO=0xYourWalletAddress AMOUNT_ETH=10 npm run fund:local
```

(`FROM` and `RPC_URL` can also be overridden.)

### Demo Flow

1. Start Anvil and run `npm run deploy:local`.
2. Run `npm run dev` and open `http://127.0.0.1:5173/`.
3. Select the Anvil Local network in MetaMask and click **Connect**.
4. Paste the factory address and click **Refresh**.
5. Create a **fixed** token: fill in the form, leave "Upgradeable" unticked, and click **Create Token**.
6. From a second wallet, buy tokens with **Mint Tokens** on the card.
7. Back on the creator wallet, notice the proceeds on the card. Use **Withdraw Fees** as the factory owner.
8. Note that **Modify** is greyed out on the fixed token: its curve can never change.
9. Tick **Upgradeable (UUPS proxy)** and create a second token. The button shows the combined fee.
10. Compare the two cards. The proxy shows `Contract: UUPS Proxy` and `Logic: v1 @ 0x…`. Every upgradeable token shares the same implementation address.
11. Click **Modify** on the proxy token, change the base price or curve type, and **Save**.
12. Check that the cost quote changed while the token's address stayed the same.
13. Switch to a wallet that doesn't own the token. Modify is disabled, and calling it directly reverts with `OwnableUnauthorizedAccount`.
14. Walk through `testOwnerCanUpgradeAndStateIsPreserved` in `test/CurveTokenUpgradeable.t.sol` to show a full logic upgrade that keeps all state.

## Verification Before Handing Off

```shell
forge fmt --check
forge test
npm run build:web
```

Expected:

- All Foundry tests pass.
- The web build passes. Vite may warn about a chunk over 500 kB because `viem` is bundled; that is expected.

## Suggested Next Phases

- A "deploy V2 and upgrade" flow in the UI, so `upgradeToAndCall` can be demoed in the browser.
- Put upgrade rights behind a timelock or multisig to show how production systems limit owner power.
- A real buy/sell reserve around the bonding curve, using `reserveRatioBps`.
- EIP-1167 minimal clones as a cheaper, non-upgradeable alternative to compare against UUPS.
- `CREATE2` for deterministic token addresses.
- Generate the frontend ABIs from Foundry artifacts instead of copying them by hand.
- Event-based indexing instead of looping over `tokenAt`.
- A helper in the frontend for switching wallet networks.
