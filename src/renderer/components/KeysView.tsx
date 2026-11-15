import { useState } from "react";
import { Check, ExternalLink, Eye, EyeOff, KeyRound, Loader2, Trash2 } from "lucide-react";
import type { AppState } from "../../shared/types";
import { bridge } from "../bridge";

export function KeysView({ s }: { s: AppState }) {
  return (
    <>
      <ApiKeySection
        title="Leetify API Key"
        description="Used for every player lookup. Works without a key at stricter rate limits; a free developer key makes lookups fast and reliable."
        linkLabel="leetify.com/app/developer"
        onOpenLink={() => bridge.openDeveloperPage()}
        hasKey={s.leetify.hasKey}
        statusLabel={
          !s.leetify.hasKey
            ? "Not set (rate limited)"
            : s.leetify.reachable === false
              ? "Saved · Unreachable"
              : "Saved · Active"
        }
        statusTone={!s.leetify.hasKey ? "neutral" : s.leetify.reachable === false ? "bad" : "ok"}
        placeholder="Paste Leetify API key"
        savingLabel="Validating…"
        onSave={(k) => bridge.setApiKey(k)}
        onClear={() => bridge.clearApiKey()}
      />

      <ApiKeySection
        title="Steam Web API Key"
        description="Optional. Used to detect Steam friendship groups in your lobby so you can see who is queued together."
        linkLabel="steamcommunity.com/dev/apikey"
        onOpenLink={() => bridge.openSteamDeveloper()}
        hasKey={s.steam.hasKey}
        statusLabel={s.steam.hasKey ? "Saved · Active" : "Optional · Not set"}
        statusTone={s.steam.hasKey ? "ok" : "neutral"}
        placeholder="Paste Steam Web API key"
        savingLabel="Saving…"
        onSave={(k) => bridge.setSteamApiKey(k)}
        onClear={() => bridge.clearSteamApiKey()}
      />

      <ApiKeySection
        title="CSRep.GG (FlareSolverr Proxy)"
        description="Optional web scraping for CSRep Trust Score, bans, flags, and CS2 hours via a local FlareSolverr instance."
        linkLabel="csrep.gg"
        onOpenLink={() => bridge.openCsrepPlayer("76561198149190660")}
        hasKey={s.csrep.hasProxy}
        statusLabel={
          !s.csrep.hasProxy
            ? "Optional · Not set"
            : s.csrep.reachable === false
              ? "Saved · Unreachable"
              : s.csrep.proxyUrl
                ? `Saved · ${s.csrep.proxyUrl}`
                : "Saved · Active"
        }
        statusTone={!s.csrep.hasProxy ? "neutral" : s.csrep.reachable === false ? "bad" : "ok"}
        placeholder="http://localhost:8191"
        savingLabel="Saving…"
        onSave={(url) => bridge.setFlaresolverrUrl(url)}
        onClear={() => bridge.clearFlaresolverrUrl()}
      />

      <ApiKeySection
        title="FACEIT Data API Key"
        description="Optional. Looks up CS2 FACEIT level and Elo directly from FACEIT when Leetify has no FACEIT data for a player."
        linkLabel="developers.faceit.com"
        onOpenLink={() => bridge.openFaceitDeveloper()}
        hasKey={s.faceit.hasKey}
        statusLabel={
          !s.faceit.hasKey
            ? "Optional · Not set"
            : s.faceit.reachable === false
              ? "Saved · Unreachable"
              : "Saved · Active"
        }
        statusTone={!s.faceit.hasKey ? "neutral" : s.faceit.reachable === false ? "bad" : "ok"}
        placeholder="Paste FACEIT server-side API key"
        savingLabel="Saving…"
        onSave={(k) => bridge.setFaceitApiKey(k)}
        onClear={() => bridge.clearFaceitApiKey()}
      />
    </>
  );
}

interface ApiKeySectionProps {
  title: string;
  description: string;
  linkLabel: string;
  onOpenLink: () => Promise<void>;
  hasKey: boolean;
  statusLabel: string;
  statusTone: "ok" | "bad" | "neutral";
  placeholder: string;
  savingLabel: string;
  onSave: (key: string) => Promise<boolean>;
  onClear: () => Promise<void>;
}

function ApiKeySection({
  title,
  description,
  linkLabel,
  onOpenLink,
  hasKey,
  statusLabel,
  statusTone,
  placeholder,
  savingLabel,
  onSave,
  onClear,
}: ApiKeySectionProps) {
  const [value, setValue] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      if (await onSave(value)) setValue("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">
            <KeyRound size={15} />
            <span>{title}</span>
          </h2>
          <p className="panel-desc">
            {description}{" "}
            <button type="button" className="link-btn" onClick={() => void onOpenLink()}>
              <span>{linkLabel}</span>
              <ExternalLink size={12} />
            </button>
          </p>
        </div>

        <span className={`key-status-badge ${statusTone === "neutral" ? "" : statusTone}`}>
          {statusTone === "ok" && <Check size={12} />}
          <span>{statusLabel}</span>
        </span>
      </div>

      {hasKey ? (
        <div className="row" style={{ justifyContent: "space-between", paddingTop: 4 }}>
          <span className="small muted">Key is stored securely in your local settings.</span>
          <button type="button" className="btn btn-sm btn-danger-outline" onClick={() => void onClear()}>
            <Trash2 size={13} />
            <span>Remove key</span>
          </button>
        </div>
      ) : (
        <div className="row" style={{ marginTop: 8 }}>
          <div className="input-wrap">
            <input
              className="input"
              type={showKey ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              placeholder={placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleSave()}
            />
            <button
              type="button"
              className="icon-btn input-eye"
              onClick={() => setShowKey((v) => !v)}
              title={showKey ? "Hide key" : "Show key"}
              aria-label={showKey ? "Hide key" : "Show key"}
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!value.trim() || busy}
            onClick={() => void handleSave()}
          >
            {busy ? <Loader2 size={14} /> : <Check size={14} />}
            <span>{busy ? savingLabel : "Save key"}</span>
          </button>
        </div>
      )}
    </section>
  );
}
