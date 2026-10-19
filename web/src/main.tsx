import React, {FormEvent, useCallback, useEffect, useMemo, useState} from "react";
import {createRoot} from "react-dom/client";
import {Coins, Factory, Loader2, RefreshCw, Send, Wallet} from "lucide-react";
import {
  Address,
  BaseError,
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
import {factoryAbi, tokenAbi} from "./abi";
import "./styles.css";

type CurveConfig = {
  curveType: number;
  basePrice: bigint;
  slope: bigint;
  reserveRatioBps: bigint;
  maxSupply: bigint;
};

type FactoryState = {
  balance: bigint;
  creationFee: bigint;
  owner: Address;
  tokenCount: bigint;
};

type MintedToken = {
  address: Address;
  creator: Address;
  name: string;
  owner: Address;
  symbol: string;
  totalSupply: bigint;
  curve: CurveConfig;
};

declare global {
  interface Window {
    ethereum?: {
      request: (args: {method: string; params?: unknown[]}) => Promise<unknown>;
    };
  }
}

const defaultRpcUrl = "http://127.0.0.1:8545";
const shortAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;
const errorMessage = (error: unknown, fallback: string) => {
  if (error instanceof BaseError) return error.shortMessage;
  if (error instanceof Error) return error.message;
  return fallback;
};

function App() {
  const [account, setAccount] = useState<Address | null>(null);
  const [factoryAddress, setFactoryAddress] = useState("");
  const [rpcUrl, setRpcUrl] = useState(defaultRpcUrl);
  const [factoryState, setFactoryState] = useState<FactoryState | null>(null);
  const [tokens, setTokens] = useState<MintedToken[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [form, setForm] = useState({
    name: "Class Demo Token",
    symbol: "CDT",
    initialSupply: "1000",
    curveType: "1",
    basePriceWei: "1000000000",
    slopeWei: "1",
    reserveRatioBps: "5000",
    maxSupply: "1000000",
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
      const [creationFee, owner, tokenCount, balance] = await Promise.all([
        publicClient.readContract({
          address: normalizedFactory,
          abi: factoryAbi,
          functionName: "creationFee",
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

      setFactoryState({balance, creationFee, owner, tokenCount});

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
          const [creator, name, symbol, tokenOwner, totalSupply, curve] = await Promise.all([
            publicClient.readContract({
              address: normalizedFactory,
              abi: factoryAbi,
              functionName: "tokenCreator",
              args: [tokenAddress],
            }),
            publicClient.readContract({address: tokenAddress, abi: tokenAbi, functionName: "name"}),
            publicClient.readContract({address: tokenAddress, abi: tokenAbi, functionName: "symbol"}),
            publicClient.readContract({address: tokenAddress, abi: tokenAbi, functionName: "owner"}),
            publicClient.readContract({address: tokenAddress, abi: tokenAbi, functionName: "totalSupply"}),
            publicClient.readContract({address: tokenAddress, abi: tokenAbi, functionName: "bondingCurve"}),
          ]);

          return {
            address: tokenAddress,
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
  }, [normalizedFactory, publicClient]);

  useEffect(() => {
    if (normalizedFactory) {
      void loadFactory();
    }
  }, [loadFactory, normalizedFactory]);

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
      const maxSupply = form.maxSupply ? parseUnits(form.maxSupply, 18) : 0n;
      const reserveRatioBps = BigInt(form.reserveRatioBps || "0");

      const hash = await walletClient.writeContract({
        address: normalizedFactory,
        abi: factoryAbi,
        functionName: "createToken",
        args: [
          form.name,
          form.symbol.toUpperCase(),
          initialSupply,
          {
            curveType: Number(form.curveType),
            basePrice: BigInt(form.basePriceWei || "0"),
            slope: BigInt(form.slopeWei || "0"),
            reserveRatioBps,
            maxSupply,
          },
        ],
        value: factoryState.creationFee,
      });

      setStatus(`Pending ${shortAddress(hash)}`);
      await publicClient.waitForTransactionReceipt({hash});
      setStatus("Token created");
      await loadFactory();
    } catch (error) {
      setStatus(errorMessage(error, "Create failed"));
    } finally {
      setIsCreating(false);
    }
  };

  const canCreate = Boolean(account && normalizedFactory && factoryState && !isCreating);

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
        <Metric label="Fee" value={factoryState ? `${formatEther(factoryState.creationFee)} ETH` : "-"} />
        <Metric label="Balance" value={factoryState ? `${formatEther(factoryState.balance)} ETH` : "-"} />
        <Metric label="Tokens" value={factoryState ? factoryState.tokenCount.toString() : "-"} />
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
            <label>
              <span>Max Supply</span>
              <input
                inputMode="decimal"
                value={form.maxSupply}
                onChange={(event) => setForm({...form, maxSupply: event.target.value})}
              />
            </label>
            <label>
              <span>Curve Type</span>
              <select value={form.curveType} onChange={(event) => setForm({...form, curveType: event.target.value})}>
                <option value="0">Flat</option>
                <option value="1">Linear</option>
              </select>
            </label>
            <label>
              <span>Reserve BPS</span>
              <input
                inputMode="numeric"
                value={form.reserveRatioBps}
                onChange={(event) => setForm({...form, reserveRatioBps: event.target.value})}
              />
            </label>
            <label>
              <span>Base Price Wei</span>
              <input
                inputMode="numeric"
                value={form.basePriceWei}
                onChange={(event) => setForm({...form, basePriceWei: event.target.value})}
              />
            </label>
            <label>
              <span>Slope Wei</span>
              <input
                inputMode="numeric"
                value={form.slopeWei}
                onChange={(event) => setForm({...form, slopeWei: event.target.value})}
              />
            </label>
          </div>

          <button className="icon-button primary submit" disabled={!canCreate} type="submit">
            {isCreating ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
            Create Token
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
              tokens.map((token) => <TokenCard key={token.address} token={token} />)
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

function TokenCard({token}: {token: MintedToken}) {
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
      </dl>
    </article>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
