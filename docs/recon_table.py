"""Writes the two generated parts of the report from the notebook's reconciliation output.

- report_recon.tex: the Appendix B table, from data/sepolia_reconciliation.csv (written by Section F).
- report_live.tex: macros for the block, time, BTC price, the number of rows and their grouping
  (Section 4.9's table), and Fund A's live state, read from the notebook's printed output and the
  same CSV, so Section 4 and every mention of the count cannot drift from Appendix B.

Run from docs/ after re-running the notebook:  python3 recon_table.py
"""
import csv
import json
import re
from decimal import Decimal

ROWS = list(csv.DictReader(open("data/sepolia_reconciliation.csv", encoding="utf-8")))


def tex(s: str) -> str:
    return s.replace("&", r"\&").replace("%", r"\%").replace("_", r"\_")


def evidence(e: str) -> str:
    m = re.search(r"tx/(0x[0-9a-f]{64})", e)
    if m:
        h = m.group(1)
        return rf"\eshort{{{h}}}{{tx \texttt{{{h[:10]}\ldots}}}}"
    return tex(e)


# ---------------------------------------------------------------- Appendix B
head = r"""\begin{center}\footnotesize
\begin{longtable}{@{}p{5.0cm}p{4.3cm}p{1.1cm}p{4.3cm}@{}}
\toprule
\textbf{Number} & \textbf{Model = on chain (wei)} & \textbf{Diff} & \textbf{Evidence} \\
\midrule
\endfirsthead
\toprule
\textbf{Number} & \textbf{Model = on chain (wei)} & \textbf{Diff} & \textbf{Evidence} \\
\midrule
\endhead
"""
lines = [head]
for r in ROWS:
    assert r["model"] == r["on chain"] and r["difference"] == "0", r
    lines.append(rf"{tex(r['number'])} & \texttt{{{r['model']}}} & {r['difference']} & {evidence(r['evidence'])} \\" + "\n")
lines.append("\\bottomrule\n\\end{longtable}\n\\end{center}\n")
open("report_recon.tex", "w", encoding="utf-8").write("".join(lines))
print(f"wrote report_recon.tex with {len(ROWS)} rows")

# ---------------------------------------------------------------- Section 4 macros
outputs = []
for cell in json.load(open("analysis.ipynb", encoding="utf-8"))["cells"]:
    for out in cell.get("outputs", []):
        outputs.append("".join(out.get("text", [])) + "".join(out.get("data", {}).get("text/plain", [])))
printed = "\n".join(outputs)
block, when = re.search(r"block (\d+), (\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC)", printed).groups()
btc = re.search(r"BTC \$([\d,]+\.\d{2})", printed).group(1)
assert all(r["evidence"] == f"read at block {block}" for r in ROWS[:10]), "CSV and notebook disagree on the block"

live = {r["number"]: r["model"] for r in ROWS}


def dollars(wei: str, places: int = 18) -> str:
    """Formats a wei amount as the report's tables do: digits grouped with {,}, 18 decimals."""
    value = abs(Decimal(wei)) / Decimal(10**18)
    whole, _, frac = f"{value:.{places}f}".partition(".")
    whole = f"{int(whole):,}".replace(",", "{,}")
    return f"{whole}.{frac}" if places else whole


def signed(wei: str) -> str:
    """A signed dollar amount for math mode, e.g. -\\$1{,}646.73..., so the table follows the sign on chain."""
    return ("-" if wei.startswith("-") else "+") + r"\$" + dollars(wei)


long_pnl, short_pnl = live["trade 1: long's unsettled P&L"], live["trade 1: short's unsettled P&L"]
assert Decimal(long_pnl) == -Decimal(short_pnl), "trade 1's unrealized P&L is not zero-sum"

# Section 4.9's summary table groups the rows by what they check. A row that fits no group stops the
# script, so a new kind of check cannot be left out of the count.
GROUPS = [
    ("Settlements (amount due and funding)", r"^trade \d+: (amount due|funding payment)$"),
    ("Vault purchase (price and sBILL taken)", r"^vault purchase: "),
    ("Vault redemption (cash received and profit)", r"^vault redemption: "),
    ("sBILL redeemed with the fund (tUSDC paid)", r"^fund redemption: "),
    ("sBILL subscriptions (NAV and shares minted)", r"^subscription: "),
    ("Live state (NAV, purchase price, funding total)", r"^(sBILL NAV|vault purchase price|sBILL the vault takes|cumulative funding)"),
    ("Account health (collateral, equity, both margin levels)", r"^Fund A: "),
    (r"Unrealized P\&L, both sides of trade 1", r"^trade 1: (long|short)'s unsettled P&L$"),
    ("Liquidation reward, stress set", r"^stress set, liquidation: reward$"),
]
counts = {label: 0 for label, _ in GROUPS}
for r in ROWS:
    for label, pattern in GROUPS:
        if re.search(pattern, r["number"]):
            counts[label] += 1
            break
    else:
        raise SystemExit(f"recon_table.py: no group for the row {r['number']!r}; add one to GROUPS")
total = len(ROWS)
table = [
    r"\begin{tabular}{@{}p{7.2cm}rp{5.4cm}@{}}",
    r"\toprule",
    r"\textbf{Read at block \reconBlock, \reconTime} & \textbf{Compared} & \textbf{Result} \\",
    r"\midrule",
]
table += [rf"{label} & {n} & {'all match' if n > 1 else 'match'} \\" for label, n in counts.items() if n]
table += [
    r"\midrule",
    rf"\textbf{{Total}} & \textbf{{{total}}} & \textbf{{{total} match, difference 0}} \\",
    r"\bottomrule",
    r"\end{tabular}",
]

macros = {
    "reconBlock": f"{int(block):,}",
    "reconTime": when,
    "reconBtc": btc,
    "reconCount": str(total),
    "reconCategoryTable": "%\n" + "\n".join(table),
    "liveLongPnlSigned": signed(long_pnl),
    "liveShortPnlSigned": signed(short_pnl),
    "liveMarginValue": dollars(live["Fund A: margin value after haircut"]),
    "liveEquity": dollars(live["Fund A: equity"]),
    "liveMaintenance": dollars(live["Fund A: maintenance margin"]),
    "liveInitial": dollars(live["Fund A: initial margin"]),
    "liveEquityRounded": dollars(str(round(Decimal(live["Fund A: equity"]) / 10**18) * 10**18), 0),
    "liveMaintenanceRounded": dollars(str(round(Decimal(live["Fund A: maintenance margin"]) / 10**18) * 10**18), 0),
}
out = ["% Generated by recon_table.py from the notebook's reconciliation read. Do not edit by hand.\n"]
out += [f"\\newcommand{{\\{name}}}{{{value}}}\n" for name, value in macros.items()]
open("report_live.tex", "w", encoding="utf-8").write("".join(out))
print(f"wrote report_live.tex: block {block}, {when}, BTC ${btc}")
