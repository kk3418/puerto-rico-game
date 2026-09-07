import type { ScoreBreakdown } from "../engine";
import "./EndScreen.css";

export function EndScreen({
  scores,
  reason,
  onAgain,
}: {
  scores: ScoreBreakdown[];
  reason: string | null;
  onAgain: () => void;
}) {
  return (
    <div className="end">
      <p className="brand">Puerto Rico</p>
      <h1>{scores[0]?.name}勝出</h1>
      <p className="end-reason">{reason}</p>
      <table>
        <thead>
          <tr>
            <th>玩家</th>
            <th>籌碼</th>
            <th>建築</th>
            <th>公會堂</th>
            <th>宅邸</th>
            <th>要塞</th>
            <th>海關</th>
            <th>市政廳</th>
            <th>總分</th>
          </tr>
        </thead>
        <tbody>
          {scores.map((s) => (
            <tr key={s.playerId}>
              <td>{s.name}</td>
              <td>{s.vpChips}</td>
              <td>{s.buildingVp}</td>
              <td>{s.guildHall}</td>
              <td>{s.residence}</td>
              <td>{s.fortress}</td>
              <td>{s.customsHouse}</td>
              <td>{s.cityHall}</td>
              <td>
                <strong>{s.total}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="start-btn" onClick={onAgain}>
        再來一局
      </button>
    </div>
  );
}
