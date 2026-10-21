import React, {FormEvent, useCallback, useEffect, useMemo, useState} from "react";
import {createRoot} from "react-dom/client";
import {Coins, Download, Factory, Loader2, PencilLine, RefreshCw, Save, Send, Wallet, X} from "lucide-react";
import {
  Address,
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseUnits,
} from "viem";
import {foundry} from "viem/chains";
import {factoryAbi, tokenAbi, upgradeableTokenAbi} from "./abi";
import "./styles.css";

type CurveConfig = {
  curveType: number;
  basePrice: bigint;
  slope: bigint;
  reserveRatioBps: bigint;
  maxSupply: bigint;
};

type CurveForm = {
  curveType: string;
  basePriceWei: string;
  slopeWei: string;
  reserveRatioBps: string;
  maxSupply: string;
};

type FactoryState = {
  balance: bigint;
  creationFee: bigint;
  owner: Address;
  ownerBalance: bigint;
  tokenCount: bigint;
  upgradeabilityFee: bigint;
};

type MintedToken = {
  accountBalance: bigint | null;
  address: Address;
  contractBalance: bigint;
  creator: Address;
  name: string;
  owner: Address;
  symbol: string;
  totalSupply: bigint;
  curve: CurveConfig;
  upgrade: {implementation: Address; version: bigint} | null;
};

declare global {
  interface Window {
    ethereum?: {
      request: (args: {method: string; params?: unknown[]}) => Promise<unknown>;
    };
  }
}

const defaultRpcUrl = "http://127.0.0.1:8545";
// ERC-1967 slot where a proxy stores its implementation address: keccak256("eip1967.proxy.implementation") - 1.
const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const shortAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;
const errorMessage = (error: unknown, fallback: string) => {
  if (error instanceof BaseError) {
    const revert = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName) {
      return `${error.shortMessage.replace(/\.$/, "")}: ${revert.data.errorName}`;
    }
    return error.shortMessage;
  }
  if (error instanceof Error) return error.message;
  return fallback;
};
const parseCurveForm = (curve: CurveForm): CurveConfig => ({
  curveType: Number(curve.curveType),
  basePrice: BigInt(curve.basePriceWei || "0"),
  slope: BigInt(curve.slopeWei || "0"),
  reserveRatioBps: BigInt(curve.reserveRatioBps || "0"),
  maxSupply: curve.maxSupply ? parseUnits(curve.maxSupply, 18) : 0n,
});
const curveToForm = (curve: CurveConfig): CurveForm => ({
  curveType: curve.curveType.toString(),
  basePriceWei: curve.basePrice.toString(),
  slopeWei: curve.slope.toString(),
  reserveRatioBps: curve.reserveRatioBps.toString(),
  maxSupply: curve.maxSupply === 0n ? "" : formatUnits(curve.maxSupply, 18),
});

function App() {
  const [account, setAccount] = useState<Address | null>(null);
  const [factoryAddress, setFactoryAddress] = useState("");
  const [rpcUrl, setRpcUrl] = useState(defaultRpcUrl);
  const [factoryState, setFactoryState] = useState<FactoryState | null>(null);
  const [tokens, setTokens] = useState<MintedToken[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isBuying, setIsBuying] = useState<Address | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isModifying, setIsModifying] = useState<Address | null>(null);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [form, setForm] = useState({
    name: "Class Demo Token",
    symbol: "CDT",
    initialSupply: "1000",
    curveType: "0",
    basePriceWei: "1",
    slopeWei: "0",
    reserveRatioBps: "5000",
    maxSupply: "1000000",
    upgradeable: false,
  });

  const normalizedFactory = useMemo(() => {
    return isAddress(factoryAddress) ? getAddress(factoryAddress) : null;
  }, [factoryAddress]);

  const publicClient = useMemo(() => {
    return createPublicClient({
      chain: foundry,
      transport: http(rpcUrl),
    });
  }, [rpcUrl]);

  useEffect(() => {
    const savedFactory = localStorage.getItem("factoryAddress");
    const savedRpc = localStorage.getItem("rpcUrl");

    if (savedFactory) setFactoryAddress(savedFactory);
    if (savedRpc) setRpcUrl(savedRpc);
  }, []);

  useEffect(() => {
    if (factoryAddress) localStorage.setItem("factoryAddress", factoryAddress);
  }, [factoryAddress]);

  useEffect(() => {
    localStorage.setItem("rpcUrl", rpcUrl);
  }, [rpcUrl]);

  const connectWallet = async () => {
    if (!window.ethereum) {
      setStatus("No injected wallet found");
      return;
    }

    const accounts = (await window.ethereum.request({method: "eth_requestAccounts"})) as Address[];
    setAccount(getAddress(accounts[0]));
    setStatus("Wallet connected");
  };

  const loadFactory = useCallback(async () => {
    if (!normalizedFactory) {
      setFactoryState(null);
      setTokens([]);
      setStatus("Enter a factory address");
      return;
    }

    setIsLoading(true);
    setStatus("Reading factory");

    try {
      const [creationFee, upgradeabilityFee, owner, tokenCount, balance] = await Promise.all([
        publicClient.readContract({
          address: normalizedFactory,
          abi: factoryAbi,
          functionName: "creationFee",
        }),
        publicClient.readContract({
          address: normalizedFactory,
          abi: factoryAbi,
          functionName: "upgradeabilityFee",
        }),
        publicClient.readContract({
          address: normalizedFactory,
          abi: factoryAbi,
          functionName: "owner",
        }),
        publicClient.readContract({
          address: normalizedFactory,
          abi: factoryAbi,
          functionName: "tokenCount",
        }),
        publicClient.getBalance({address: normalizedFactory}),
      ]);
      const ownerBalance = await publicClient.getBalance({address: owner});

      setFactoryState({balance, creationFee, owner, ownerBalance, tokenCount, upgradeabilityFee});

      const tokenAddresses = await Promise.all(
        Array.from({length: Number(tokenCount)}, (_, index) =>
          publicClient.readContract({
            address: normalizedFactory,
            abi: factoryAbi,
            functionName: "tokenAt",
            args: [BigInt(index)],
          }),
        ),
      );

      const hydratedTokens = await Promise.all(
        tokenAddresses.map(async (tokenAddress) => {
          const [creator, upgradeable, name, symbol, tokenOwner, totalSupply, curve, contractBalance, accountBalance] =
            await Promise.all([
            publicClient.readContract({
              address: normalizedFactory,
              abi: factoryAbi,
              functionName: "tokenCreator",
              args: [tokenAddress],
            }),
            publicClient.readContract({
              address: normalizedFactory,
              abi: factoryAbi,
              functionName: "isUpgradeable",
              args: [tokenAddress],
            }),
            publicClient.readContract({address: tokenAddress, abi: tokenAbi, functionName: "name"}),
            publicClient.readContract({address: tokenAddress, abi: tokenAbi, functionName: "symbol"}),
            publicClient.readContract({address: tokenAddress, abi: tokenAbi, functionName: "owner"}),
            publicClient.readContract({address: tokenAddress, abi: tokenAbi, functionName: "totalSupply"}),
            publicClient.readContract({address: tokenAddress, abi: tokenAbi, functionName: "bondingCurve"}),
            publicClient.getBalance({address: tokenAddress}),
            account
              ? publicClient.readContract({
                  address: tokenAddress,
                  abi: tokenAbi,
                  functionName: "balanceOf",
                  args: [account],
                })
              : Promise.resolve(null),
          ]);

          let upgrade: MintedToken["upgrade"] = null;
          if (upgradeable) {
            const [slotValue, version] = await Promise.all([
              publicClient.getStorageAt({address: tokenAddress, slot: implementationSlot}),
              publicClient.readContract({address: tokenAddress, abi: upgradeableTokenAbi, functionName: "version"}),
            ]);
            upgrade = {implementation: getAddress(`0x${(slotValue ?? "0x").slice(-40).padStart(40, "0")}`), version};
          }

          return {
            accountBalance,
            address: tokenAddress,
            contractBalance,
            creator,
            name,
            owner: tokenOwner,
            symbol,
            totalSupply,
            curve: {
              curveType: curve[0],
              basePrice: curve[1],
              slope: curve[2],
              reserveRatioBps: curve[3],
              maxSupply: curve[4],
            },
            upgrade,
          };
        }),
      );

      setTokens(hydratedTokens);
      setStatus("Factory loaded");
    } catch (error) {
      setFactoryState(null);
      setTokens([]);
      setStatus(errorMessage(error, "Factory read failed"));
    } finally {
      setIsLoading(false);
    }
  }, [account, normalizedFactory, publicClient]);

  useEffect(() => {
    if (normalizedFactory) {
      void loadFactory();
    }
  }, [loadFactory, normalizedFactory]);

  const createCost = factoryState
    ? factoryState.creationFee + (form.upgradeable ? factoryState.upgradeabilityFee : 0n)
    : 0n;

  const createToken = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!window.ethereum || !account || !normalizedFactory || !factoryState) {
      setStatus("Connect wallet and load factory");
      return;
    }

    setIsCreating(true);
    setStatus("Confirm in wallet");

    try {
      const walletClient = createWalletClient({
        account,
        chain: foundry,
        transport: custom(window.ethereum),
      });

      const initialSupply = parseUnits(form.initialSupply || "0", 18);
      const curveConfig = parseCurveForm(form);
      const createArgs = [form.name, form.symbol.toUpperCase(), initialSupply, curveConfig] as const;
      const functionName = form.upgradeable ? "createUpgradeableToken" : "createToken";

      if (curveConfig.maxSupply !== 0n && initialSupply > curveConfig.maxSupply) {
        setStatus("Max supply must be at least initial supply");
        return;
      }

      await publicClient.simulateContract({
        account,
        address: normalizedFactory,
        abi: factoryAbi,
        functionName,
        args: createArgs,
        value: createCost,
      });

      const hash = await walletClient.writeContract({
        address: normalizedFactory,
        abi: factoryAbi,
        functionName,
        args: createArgs,
        value: createCost,
      });

      setStatus(`Pending ${shortAddress(hash)}`);
      const receipt = await publicClient.waitForTransactionReceipt({hash});
      if (receipt.status !== "success") {
        setStatus(`Transaction reverted: ${shortAddress(hash)}`);
        return;
      }

      setStatus(form.upgradeable ? "Upgradeable token created" : "Token created");
      await loadFactory();
    } catch (error) {
      setStatus(errorMessage(error, "Create failed"));
    } finally {
      setIsCreating(false);
    }
  };

  const withdrawFees = async () => {
    if (!window.ethereum || !account || !normalizedFactory || !factoryState) {
      setStatus("Connect wallet and load factory");
      return;
    }

    setIsWithdrawing(true);
    setStatus("Confirm fee withdrawal");

    try {
      const walletClient = createWalletClient({
        account,
        chain: foundry,
        transport: custom(window.ethereum),
      });
      const withdrawArgs = [account] as const;

      await publicClient.simulateContract({
        account,
        address: normalizedFactory,
        abi: factoryAbi,
        functionName: "withdrawFees",
        args: withdrawArgs,
      });

      const hash = await walletClient.writeContract({
        address: normalizedFactory,
        abi: factoryAbi,
        functionName: "withdrawFees",
        args: withdrawArgs,
      });

      setStatus(`Pending ${shortAddress(hash)}`);
      const receipt = await publicClient.waitForTransactionReceipt({hash});
      if (receipt.status !== "success") {
        setStatus(`Withdrawal reverted: ${shortAddress(hash)}`);
        return;
      }

      setStatus("Fees withdrawn");
      await loadFactory();
    } catch (error) {
      setStatus(errorMessage(error, "Withdraw failed"));
    } finally {
      setIsWithdrawing(false);
    }
  };

  const mintTokenFromCurve = async (token: MintedToken, amountInput: string) => {
    if (!window.ethereum || !account) {
      setStatus("Connect wallet to mint from curve");
      return;
    }

    const amount = parseUnits(amountInput || "0", 18);
    setIsBuying(token.address);
    setStatus("Quoting curve mint");

    try {
      const walletClient = createWalletClient({
        account,
        chain: foundry,
        transport: custom(window.ethereum),
      });
      const mintArgs = [amount] as const;
      const cost = await publicClient.readContract({
        address: token.address,
        abi: tokenAbi,
        functionName: "quoteMintCost",
        args: mintArgs,
      });

      await publicClient.simulateContract({
        account,
        address: token.address,
        abi: tokenAbi,
        functionName: "mintFromCurve",
        args: mintArgs,
        value: cost,
      });

      setStatus(`Confirm mint for ${formatEther(cost)} ETH`);
      const hash = await walletClient.writeContract({
        address: token.address,
        abi: tokenAbi,
        functionName: "mintFromCurve",
        args: mintArgs,
        value: cost,
      });

      setStatus(`Pending ${shortAddress(hash)}`);
      const receipt = await publicClient.waitForTransactionReceipt({hash});
      if (receipt.status !== "success") {
        setStatus(`Curve mint reverted: ${shortAddress(hash)}`);
        return;
      }

      setStatus(`Minted ${amountInput} ${token.symbol}`);
      await loadFactory();
    } catch (error) {
      setStatus(errorMessage(error, "Curve mint failed"));
    } finally {
      setIsBuying(null);
    }
  };

  const updateTokenCurve = async (token: MintedToken, curveForm: CurveForm) => {
    if (!window.ethereum || !account) {
      setStatus("Connect wallet to modify the contract");
      return false;
    }

    setIsModifying(token.address);
    setStatus("Confirm parameter update");

    try {
      const newConfig = parseCurveForm(curveForm);
      if (newConfig.reserveRatioBps > 10_000n) {
        setStatus("Reserve BPS must be 10000 or less");
        return false;
      }
      if (newConfig.maxSupply !== 0n && newConfig.maxSupply < token.totalSupply) {
        setStatus("Max supply cannot be below current supply");
        return false;
      }

      const walletClient = createWalletClient({
        account,
        chain: foundry,
        transport: custom(window.ethereum),
      });
      const updateArgs = [newConfig] as const;

      await publicClient.simulateContract({
        account,
        address: token.address,
        abi: upgradeableTokenAbi,
        functionName: "updateBondingCurve",
        args: updateArgs,
      });

      const hash = await walletClient.writeContract({
        address: token.address,
        abi: upgradeableTokenAbi,
        functionName: "updateBondingCurve",
        args: updateArgs,
      });

      setStatus(`Pending ${shortAddress(hash)}`);
      const receipt = await publicClient.waitForTransactionReceipt({hash});
      if (receipt.status !== "success") {
        setStatus(`Update reverted: ${shortAddress(hash)}`);
        return false;
      }

      setStatus(`${token.symbol} parameters updated`);
      await loadFactory();
      return true;
    } catch (error) {
      setStatus(errorMessage(error, "Update failed"));
      return false;
    } finally {
      setIsModifying(null);
    }
  };

  const canCreate = Boolean(account && normalizedFactory && factoryState && !isCreating);
  const canWithdraw = Boolean(
    account && normalizedFactory && factoryState && factoryState.balance > 0n && !isWithdrawing,
  );

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <div className="eyebrow">
            <Factory size={16} />
            Factory Console
          </div>
          <h1>Curve Token Factory</h1>
        </div>
        <button className="icon-button primary" onClick={connectWallet} type="button">
          <Wallet size={18} />
          {account ? shortAddress(account) : "Connect"}
        </button>
      </section>

      <section className="control-band">
        <label>
          <span>Factory</span>
          <input
            placeholder="0x..."
            value={factoryAddress}
            onChange={(event) => setFactoryAddress(event.target.value)}
          />
        </label>
        <label>
          <span>RPC</span>
          <input value={rpcUrl} onChange={(event) => setRpcUrl(event.target.value)} />
        </label>
        <button className="icon-button" disabled={isLoading} onClick={loadFactory} type="button">
          {isLoading ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
          Refresh
        </button>
      </section>

      <section className="summary-grid">
        <Metric label="Owner" value={factoryState ? shortAddress(factoryState.owner) : "-"} />
        <Metric label="Owner Balance" value={factoryState ? `${formatEther(factoryState.ownerBalance)} ETH` : "-"} />
        <Metric label="Fee" value={factoryState ? `${formatEther(factoryState.creationFee)} ETH` : "-"} />
        <Metric
          label="Upgrade Fee"
          value={factoryState ? `+${formatEther(factoryState.upgradeabilityFee)} ETH` : "-"}
        />
        <Metric label="Balance" value={factoryState ? `${formatEther(factoryState.balance)} ETH` : "-"} />
        <Metric label="Tokens" value={factoryState ? factoryState.tokenCount.toString() : "-"} />
      </section>

      <section className="admin-band">
        <div>
          <span>Fee Admin</span>
          <strong>{account ? `Withdraw to ${shortAddress(account)}` : "Connect wallet to withdraw"}</strong>
        </div>
        <button className="icon-button" disabled={!canWithdraw} onClick={withdrawFees} type="button">
          {isWithdrawing ? <Loader2 className="spin" size={18} /> : <Download size={18} />}
          Withdraw Fees
        </button>
      </section>

      <section className="workbench">
        <form className="panel create-panel" onSubmit={createToken}>
          <div className="panel-title">
            <Coins size={18} />
            <h2>Mint Contract</h2>
          </div>

          <div className="field-grid">
            <label>
              <span>Name</span>
              <input value={form.name} onChange={(event) => setForm({...form, name: event.target.value})} />
            </label>
            <label>
              <span>Symbol</span>
              <input value={form.symbol} onChange={(event) => setForm({...form, symbol: event.target.value})} />
            </label>
            <label>
              <span>Initial Supply</span>
              <input
                inputMode="decimal"
                value={form.initialSupply}
                onChange={(event) => setForm({...form, initialSupply: event.target.value})}
              />
            </label>
            <CurveFields value={form} onChange={(curve) => setForm({...form, ...curve})} />
          </div>

          <label className="toggle-row">
            <input
              checked={form.upgradeable}
              onChange={(event) => setForm({...form, upgradeable: event.target.checked})}
              type="checkbox"
            />
            <div>
              <strong>Upgradeable (UUPS proxy)</strong>
              <small>
                Deploys an ERC-1967 proxy so you can modify parameters later
                {factoryState ? ` · +${formatEther(factoryState.upgradeabilityFee)} ETH` : ""}
              </small>
            </div>
          </label>

          <button className="icon-button primary submit" disabled={!canCreate} type="submit">
            {isCreating ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
            {factoryState ? `Create Token · ${formatEther(createCost)} ETH` : "Create Token"}
          </button>
        </form>

        <section className="panel token-panel">
          <div className="panel-title">
            <Factory size={18} />
            <h2>Minted Contracts</h2>
          </div>
          <div className="token-list">
            {tokens.length === 0 ? (
              <div className="empty-state">No token contracts</div>
            ) : (
              tokens.map((token) => (
                <TokenCard
                  account={account}
                  isBuying={isBuying === token.address}
                  isModifying={isModifying === token.address}
                  key={token.address}
                  onMint={mintTokenFromCurve}
                  onUpdateCurve={updateTokenCurve}
                  token={token}
                />
              ))
            )}
          </div>
        </section>
      </section>

      <footer className="status-bar">
        <span>Status</span>
        <strong>{status}</strong>
      </footer>
    </main>
  );
}

function Metric({label, value}: {label: string; value: string}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CurveFields({value, onChange}: {value: CurveForm; onChange: (curve: CurveForm) => void}) {
  const field = (key: keyof CurveForm) => ({
    value: value[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange({...value, [key]: event.target.value}),
  });

  return (
    <>
      <label>
        <span>Max Supply</span>
        <input inputMode="decimal" placeholder="0 = uncapped" {...field("maxSupply")} />
      </label>
      <label>
        <span>Curve Type</span>
        <select {...field("curveType")}>
          <option value="0">Flat</option>
          <option value="1">Linear</option>
        </select>
      </label>
      <label>
        <span>Reserve BPS</span>
        <input inputMode="numeric" {...field("reserveRatioBps")} />
      </label>
      <label>
        <span>Base Price Wei</span>
        <input inputMode="numeric" {...field("basePriceWei")} />
      </label>
      <label>
        <span>Slope Wei</span>
        <input inputMode="numeric" {...field("slopeWei")} />
      </label>
    </>
  );
}

function quoteDisplayCost(token: MintedToken, amountInput: string) {
  try {
    const amount = parseUnits(amountInput || "0", 18);
    if (amount === 0n) return 0n;

    if (token.curve.curveType === 0) {
      return token.curve.basePrice * amount;
    }

    const startingPrice = token.curve.basePrice + token.curve.slope * token.totalSupply;
    const endingPrice = token.curve.basePrice + token.curve.slope * (token.totalSupply + amount - 1n);
    return ((startingPrice + endingPrice) * amount) / 2n;
  } catch {
    return null;
  }
}

function TokenCard({
  account,
  isBuying,
  isModifying,
  onMint,
  onUpdateCurve,
  token,
}: {
  account: Address | null;
  isBuying: boolean;
  isModifying: boolean;
  onMint: (token: MintedToken, amountInput: string) => void;
  onUpdateCurve: (token: MintedToken, curveForm: CurveForm) => Promise<boolean>;
  token: MintedToken;
}) {
  const [buyAmount, setBuyAmount] = useState("1");
  const [draftCurve, setDraftCurve] = useState<CurveForm | null>(null);
  const quotedCost = quoteDisplayCost(token, buyAmount);
  const isOwner = account !== null && account === token.owner;
  const canModify = token.upgrade !== null && isOwner;
  const modifyHint = !token.upgrade
    ? "Fixed contract: parameters cannot change"
    : isOwner
      ? "Edit the curve parameters stored in the proxy"
      : "Only the token owner can modify this contract";

  const saveCurve = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draftCurve && (await onUpdateCurve(token, draftCurve))) {
      setDraftCurve(null);
    }
  };

  return (
    <article className="token-card">
      <div className="token-head">
        <div>
          <h3>{token.name}</h3>
          <span>{token.symbol}</span>
        </div>
        <code>{shortAddress(token.address)}</code>
      </div>
      <dl>
        <div>
          <dt>Supply</dt>
          <dd>{formatUnits(token.totalSupply, 18)}</dd>
        </div>
        <div>
          <dt>Cap</dt>
          <dd>{token.curve.maxSupply === 0n ? "None" : formatUnits(token.curve.maxSupply, 18)}</dd>
        </div>
        <div>
          <dt>Creator</dt>
          <dd>{shortAddress(token.creator)}</dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>{shortAddress(token.owner)}</dd>
        </div>
        <div>
          <dt>Curve</dt>
          <dd>{token.curve.curveType === 0 ? "Flat" : "Linear"}</dd>
        </div>
        <div>
          <dt>Reserve</dt>
          <dd>{token.curve.reserveRatioBps.toString()} bps</dd>
        </div>
        <div>
          <dt>Proceeds</dt>
          <dd>{formatEther(token.contractBalance)} ETH</dd>
        </div>
        <div>
          <dt>Your Balance</dt>
          <dd>{account && token.accountBalance !== null ? formatUnits(token.accountBalance, 18) : "-"}</dd>
        </div>
        <div>
          <dt>Contract</dt>
          <dd>{token.upgrade ? "UUPS Proxy" : "Fixed"}</dd>
        </div>
        <div>
          <dt>Logic</dt>
          <dd>{token.upgrade ? `v${token.upgrade.version} @ ${shortAddress(token.upgrade.implementation)}` : "Built-in"}</dd>
        </div>
      </dl>
      <div className="curve-mint">
        <label>
          <span>Mint Amount</span>
          <input inputMode="decimal" value={buyAmount} onChange={(event) => setBuyAmount(event.target.value)} />
        </label>
        <div className="quote-line">
          <span>Cost</span>
          <strong>{quotedCost === null ? "-" : `${formatEther(quotedCost)} ETH`}</strong>
        </div>
        <button
          className="icon-button"
          disabled={!account || isBuying || quotedCost === null}
          onClick={() => onMint(token, buyAmount)}
          type="button"
        >
          {isBuying ? <Loader2 className="spin" size={18} /> : <Coins size={18} />}
          Mint Tokens
        </button>
      </div>
      <div className="modify-section">
        {draftCurve ? (
          <form className="modify-form" onSubmit={saveCurve}>
            <div className="field-grid">
              <CurveFields value={draftCurve} onChange={setDraftCurve} />
            </div>
            <div className="modify-actions">
              <button className="icon-button" disabled={isModifying} onClick={() => setDraftCurve(null)} type="button">
                <X size={18} />
                Cancel
              </button>
              <button className="icon-button primary" disabled={isModifying} type="submit">
                {isModifying ? <Loader2 className="spin" size={18} /> : <Save size={18} />}
                Save
              </button>
            </div>
          </form>
        ) : (
          <button
            className="icon-button"
            disabled={!canModify}
            onClick={() => setDraftCurve(curveToForm(token.curve))}
            title={modifyHint}
            type="button"
          >
            <PencilLine size={18} />
            Modify
          </button>
        )}
      </div>
    </article>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
