import Icon from './icons.jsx'

// The photo just taken, with what to do with it: download it, or save it into
// the photo folder. Laid out like the save-face card (picture left, details right).
export default function PhotoCard({ photo, onDownload, onSave, onClose }) {
  const { url, saved, saving, downloaded, error } = photo
  return (
    <div className="pending photo-card surface" role="dialog" aria-label="Photo taken">
      <img className="avatar" src={url} alt="The photo just taken" />
      <div className="pending-side">
        <div className="pending-text">
          <strong>Photo taken</strong>
          <em className="pending-sub">{photo.name}.jpg</em>
          {saved && <small>Saved to {saved}</small>}
          {downloaded && !saved && <small>Downloaded.</small>}
          {error && <small className="photo-error">{error}</small>}
          {!saved && !downloaded && !error && <small>You can also say “download it” or “save it”.</small>}
        </div>
        <div className="pending-actions">
          <button className="btn primary" onClick={onDownload}>
            <Icon name="download" size={16} /> Download
          </button>
          <button className="btn" onClick={onSave} disabled={saving || !!saved}>
            <Icon name="folder" size={16} /> {saving ? 'Saving…' : saved ? 'Saved' : 'Save to folder'}
          </button>
          <button className="btn photo-close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
