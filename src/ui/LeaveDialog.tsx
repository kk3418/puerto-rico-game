import "./LeaveDialog.css";

export function LeaveDialog({
  onYes,
  onNo,
}: {
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div className="leave-dialog" role="dialog" aria-modal="true" aria-labelledby="leave-title">
      <div className="leave-card">
        <h2 id="leave-title">是否要存檔？</h2>
        <div className="leave-actions">
          <button type="button" className="text-btn" onClick={onNo}>
            否
          </button>
          <button type="button" className="text-btn" onClick={onYes}>
            是
          </button>
        </div>
      </div>
    </div>
  );
}
