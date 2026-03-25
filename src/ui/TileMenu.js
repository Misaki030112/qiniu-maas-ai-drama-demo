"use client";

function closeTileMenu(target) {
  target?.closest("details")?.removeAttribute("open");
}

function TileMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="6.5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="17.5" cy="12" r="1.7" />
    </svg>
  );
}

export function TileMenu({ items = [], label = "更多操作" }) {
  return (
    <details className="studio-tile-menu" onClick={(event) => event.stopPropagation()}>
      <summary className="studio-tile-menu__trigger" aria-label={label} title={label}>
        <TileMenuIcon />
      </summary>
      <div className="studio-tile-menu__panel">
        {items.filter(Boolean).map((item, index) => {
          if (item.type === "info") {
            return <div key={`${item.label}-${index}`} className="studio-tile-menu__info">{item.label}</div>;
          }
          return (
            <button
              key={`${item.label}-${index}`}
              type="button"
              className={item.danger ? "studio-tile-menu__action studio-tile-menu__action--danger" : "studio-tile-menu__action"}
              disabled={item.disabled}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                item.onSelect?.();
                closeTileMenu(event.currentTarget);
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </details>
  );
}
