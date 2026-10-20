import { useProductUpdates } from '@/features/updates/useProductUpdates';
import styles from './ReleaseHistory.module.css';

const releaseTime = (value: string) => new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short',
}).format(new Date(value));

export function ReleaseHistory() {
  const {data,error}=useProductUpdates();
  if(!data)return <section className={styles.history} aria-labelledby="release-history-title"><h2 id="release-history-title">Lịch sử cập nhật</h2><p role={error?'alert':'status'}>{error?'Chưa tải được lịch sử từ máy chủ. Hệ thống sẽ thử lại khi bạn quay lại trang.':'Đang tải lịch sử cập nhật…'}</p></section>;
  const releaseNotes=data.catalog.notes;
  return <section className={styles.history} aria-labelledby="release-history-title">
    <div className={styles.heading}>
      <div><p className={styles.eyebrow}>Calenote qua từng phiên bản</p><h2 id="release-history-title">Lịch sử cập nhật</h2></div>
      <span className={styles.count}>{releaseNotes.length} bản cập nhật</span>
    </div>
    <p className={styles.intro}>Nội dung từ máy chủ đang phục vụ, mới nhất ở trên. Mốc lịch sử có ngày giờ Việt Nam; mục đầu mô tả tính năng đi kèm bản ứng dụng này, không phải tra cứu phiên bản Worker đang chạy.</p>
    {error && <p role="status">Chưa làm mới được lịch sử; đang hiển thị lần tải gần nhất.</p>}
    <ol className={styles.list}>
      {releaseNotes.map((note, index) => <li key={note.id} id={`release-${note.commit?.slice(0, 7) ?? note.id}`}>
        <details className={styles.card} open={index === 0}>
          <summary className={styles.summary}>
            <div className={styles.meta}>{note.releasedAt ? <time dateTime={note.releasedAt}>{releaseTime(note.releasedAt)}</time> : <span>Trong bản ứng dụng này</span>}<span className={styles.tag}>{note.kind}</span></div>
            <h3>{note.title}</h3>
            <p>{note.summary}</p>
            <span className={styles.version}><code>{note.commit?.slice(0, 7) ?? note.id}</code><span>{note.releasedAt ? "Mốc đã phát hành" : "Nội dung phiên bản"}</span></span>
            <span className={styles.expand} aria-hidden="true">Chi tiết <span>⌄</span></span>
          </summary>
          <div className={styles.body}>
            <h4>Thay đổi trong bản này</h4>
            <ul>{note.changes.map(change => <li key={change}>{change}</li>)}</ul>
            <div className={styles.verification}><h4>Phạm vi kiểm tra</h4><p>{note.verification}</p></div>
            {note.caveat && <p className={styles.caveat}><strong>Lưu ý: </strong>{note.caveat}</p>}
            {note.commit && <a className={styles.commitLink} href={`https://github.com/nguyenxtan/calenote/commit/${note.commit}`} target="_blank" rel="noopener noreferrer" aria-label={`Xem commit ${note.commit.slice(0, 7)}`}>Xem commit {note.commit.slice(0, 7)} <span aria-hidden="true">↗</span><span className={styles.srOnly}> (mở tab mới)</span></a>}
          </div>
        </details>
      </li>)}
    </ol>
  </section>;
}
