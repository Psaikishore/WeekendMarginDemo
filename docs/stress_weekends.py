"""Historical stress weekends: what each crisis closure would have drawn from the vault.

Writes report_stress.tex, the regime table in report.tex Section 4, from the cached Coinbase hourly
series, with the same definitions as the notebook's Section C: a closure runs 65 hours from Friday
4pm New York time on hourly settlement prices (the open of each hourly candle, as in the notebook),
and the amount sold to the vault is the largest loss reached at any hourly settlement during the
closure (the adverse excursion), not the Friday-to-Monday move.

Run from anywhere:  python3 docs/stress_weekends.py
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
protocol = json.loads((ROOT / "config" / "protocol.json").read_text())
assume = json.loads((ROOT / "config" / "assumptions.json").read_text())
MM = protocol["maintenanceMarginBps"] / 1e4
H_WEEKEND = 1 - protocol["weekendHaircutBps"] / 1e4
CLOSURE_H = assume["market"]["closureHours"]
DEMO_LEV = assume["demoPosition"]["entryPrice"] / assume["demoPosition"]["marginUsd"]
NOTIONAL = 1_000_000

# The crises the report names. Each is the worst closure within three weeks of the event.
CRISES = [
    ("Yen carry unwind", "2024-08-02"),
    ("June 2022 CPI shock", "2022-06-10"),
    ("SVB / USDC depeg", "2023-03-10"),
    ("May 2021 mining ban", "2021-05-14"),
    ("LUNA/UST collapse", "2022-05-06"),
    ("Oct 2025 liquidations", "2025-10-10"),
    ("FTX collapse", "2022-11-11"),
]
WORDS = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven"}

btc = pd.read_csv(ROOT / "docs" / "data" / "btc_usd_1h_coinbase.csv", parse_dates=["time"]).set_index("time")
# One row per hour, the open of each hourly candle as the settlement price, exactly as the notebook does.
btc = btc.reindex(pd.date_range(btc.index.min(), btc.index.max(), freq="h"))
px = btc["open"].fillna(btc["close"].ffill())
P = px.values
ny = px.index.tz_convert("America/New_York")
fridays = np.where((ny.day_of_week == 4) & (ny.hour == 16))[0]
fridays = fridays[fridays + CLOSURE_H < len(P)]

rows = []
for i in fridays:
    path = P[i : i + CLOSURE_H + 1]
    rows.append({
        "start": ny[i].strftime("%Y-%m-%d"),
        "friday price": P[i],
        "short sells": max(0.0, path.max() / P[i] - 1),   # a short loses when the price rises
        "long sells": max(0.0, 1 - path.min() / P[i]),    # a long loses when it falls
    })
weekends = pd.DataFrame(rows).set_index("start")
weekends["worst side"] = weekends[["short sells", "long sells"]].max(axis=1)
dates = pd.to_datetime(weekends.index)


def liquidation_move(leverage: float, is_long: bool) -> float:
    """Price move, as a share of the entry price, that liquidates an sBILL-margined position at the weekend haircut."""
    deposit = 1 / leverage                      # margin per dollar of notional
    h, m = H_WEEKEND, MM
    if is_long:
        return 1 - h * (1 - deposit) / (h - m)   # P_liq / P0 = h (P0 - D) / ((h - m) P0)
    return h * (deposit + 1) / (m + h) - 1       # P_liq / P0 = h (D + P0) / ((m + h) P0)


vault95 = weekends["worst side"].quantile(0.95) * NOTIONAL
typical = weekends["worst side"].mean()

print(f"{len(weekends)} weekend closures. Typical weekend (mean of the losing side's excursion): {typical:.2%}.")
print(f"A vault sized at the 95th percentile of that excursion holds ${vault95:,.0f} per $1m of notional.\n")
print(f"{'Regime':<30}{'Weekend':<12}{'BTC Fri 4pm':>12}{'Excursion':>11}{'Side':>7}{'Sold / $1m':>12}{'% of 95th vault':>17}   worst closure within 3 weeks")
table = []
for name, day in CRISES:
    w = weekends.loc[day]
    side = "long" if w["long sells"] >= w["short sells"] else "short"
    sold = w["worst side"] * NOTIONAL
    around = weekends.loc[(dates >= pd.Timestamp(day) - pd.Timedelta(days=21)) & (dates <= pd.Timestamp(day) + pd.Timedelta(days=21))]
    worst = around["worst side"].idxmax()
    assert worst == day, f"{name}: the worst closure within three weeks is {worst}, not {day}"
    print(f"{name:<30}{day:<12}{w['friday price']:>12,.0f}{w['worst side']:>11.2%}{side:>7}{sold:>12,.0f}{sold / vault95:>16.0%}   {worst} ({around.loc[worst, 'worst side']:.2%})")
    table.append((name, day, w["friday price"], w["worst side"], side, sold, sold / vault95))

print("\nWould the position have been liquidated? (sBILL margin, weekend haircut)")
for lev in (DEMO_LEV, 4.0, 4.85):
    hits = []
    for name, day in CRISES:
        w = weekends.loc[day]
        if w["long sells"] >= liquidation_move(lev, True):
            hits.append(f"{name} (long)")
        if w["short sells"] >= liquidation_move(lev, False):
            hits.append(f"{name} (short)")
    print(f"  {lev:.2f}x: long liquidated at a {liquidation_move(lev, True):.1%} fall, short at a {liquidation_move(lev, False):.1%} rise -> "
          + (", ".join(hits) if hits else "none"))

# ---------------------------------------------------------------- the report's table and macros
usd = lambda v: "\\$" + f"{v:,.0f}".replace(",", "{,}")
lines = [
    "% Generated by stress_weekends.py from docs/data/btc_usd_1h_coinbase.csv. Do not edit by hand.\n",
    f"\\newcommand{{\\stressVaultNinetyFive}}{{{usd(vault95)[2:]}}}\n",
    f"\\newcommand{{\\stressTypicalPct}}{{{typical:.2%}}}\n".replace("%}", "\\%}"),
    f"\\newcommand{{\\stressExceed}}{{{WORDS[sum(1 for t in table if t[6] > 1)]}}}\n",
    "\\newcommand{\\stressTable}{\\setlength{\\tabcolsep}{4pt}%\n",
    "\\begin{tabular}{@{}p{3.6cm}p{1.8cm}rrrr>{\\raggedright\\arraybackslash}p{1.7cm}@{}}\n\\toprule\n",
    "\\textbf{Regime} & \\textbf{Weekend} & \\textbf{BTC Fri 4pm} & \\textbf{Excursion} & \\textbf{Loser} & \\textbf{Sold per \\$1m} & \\textbf{\\% of 95th-pct vault} \\\\\n\\midrule\n",
]
for name, day, price, exc, side, sold, share in table:
    pct = f"{share:.0%}".replace("%", "\\%")
    lines.append(f"{name} & {day} & {usd(price)} & {exc:.2%} & {side} & {usd(sold)} & {'\\textbf{' + pct + '}' if share > 1 else pct} \\\\\n".replace("% &", "\\% &"))
lines.append(f"\\midrule\nTypical weekend & --- & --- & {typical:.2%} & --- & {usd(typical * NOTIONAL)} & {typical * NOTIONAL / vault95:.0%} \\\\\n".replace("% &", "\\% &").replace("% \\\\", "\\% \\\\"))
lines.append("\\bottomrule\n\\end{tabular}}\n")
(ROOT / "docs" / "report_stress.tex").write_text("".join(lines), encoding="utf-8")
print("\nwrote docs/report_stress.tex")
