import styles from './FollowThroughPanel.module.css';

/** UI-only recovery: Worker actions, delivery fences and persisted work stay intact. */
export function FollowThroughRecoveryNotice() {
  return <aside className={styles.panel} role="note" aria-label="Giao diện dự phòng">
    <h2>Tiến độ việc đang dùng giao diện dự phòng</h2>
    <p>Gửi “xong” trong bot đã kết nối để xem mã việc, rồi chọn việc cần xử lý.</p>
    <p><code>xong &lt;mã việc&gt;</code> · <code>dừng theo dõi &lt;mã việc&gt;</code></p>
    <p>Lời nhắc và lịch sử của bạn được giữ lại. Trạng thái đã gửi vẫn khác với đã làm xong.</p>
  </aside>;
}
