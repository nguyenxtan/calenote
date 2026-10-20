import { releaseNotes } from './release-notes';
import styles from './ReleaseHistory.module.css';

const releaseTime = (value: string) => new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short',
}).format(new Date(value));

export function ReleaseHistory() {
  return <section className={styles.history} aria-labelledby="release-history-title">
    <div className={styles.heading}>
      <div><p className={styles.eyebrow}>Calenote qua từng phiên bản</p><h2 id="release-history-title">Lịch sử cập nhật</h2></div>
      <span className={styles.count}>{releaseNotes.length} bản phát hành</span>
    </div>
    <p className={styles.intro}>Các mốc đã phát hành được đối chiếu, mới nhất ở trên. Mở từng bản để xem thay đổi và phạm vi kiểm tra. Giờ Việt Nam.</p>
    <ol className={styles.list}>
      {releaseNotes.map((note, index) => <li key={note.commit} id={`release-${note.commit.slice(0, 7)}`}>
        <details className={styles.card} open={index === 0}>
          <summary className={styles.summary}>
            <div className={styles.meta}><time dateTime={note.releasedAt}>{releaseTime(note.releasedAt)}</time><span className={styles.tag}>{note.kind}</span></div>
            <h3>{note.title}</h3>
            <p>{note.summary}</p>
            <span className={styles.version}><code>{note.commit.slice(0, 7)}</code><span>Đã phát hành</span></span>
            <span className={styles.expand} aria-hidden="true">Chi tiết <span>⌄</span></span>
          </summary>
          <div className={styles.body}>
            <h4>Thay đổi trong bản này</h4>
            <ul>{note.changes.map(change => <li key={change}>{change}</li>)}</ul>
            <div className={styles.verification}><h4>Kiểm tra sau phát hành</h4><p>{note.verification}</p></div>
            {note.caveat && <p className={styles.caveat}><strong>Lưu ý: </strong>{note.caveat}</p>}
            <a className={styles.commitLink} href={`https://github.com/nguyenxtan/calenote/commit/${note.commit}`} target="_blank" rel="noopener noreferrer" aria-label={`Xem commit ${note.commit.slice(0, 7)}`}>Xem commit {note.commit.slice(0, 7)} <span aria-hidden="true">↗</span><span className={styles.srOnly}> (mở tab mới)</span></a>
          </div>
        </details>
      </li>)}
    </ol>
  </section>;
}
