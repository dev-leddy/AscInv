import { useState, useMemo, useEffect, useCallback, Fragment } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  getExpandedRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table'

const API_BASE   = 'https://ascendanteq.com/api/characters'
const ITEM_API   = 'https://ascendanteq.com/api/items'
const AA_API     = 'https://ascendanteq.com/api/aa/universal/tree'
const ICON_BASE  = 'https://ascendanteq.com/icons/item_'

// ── Class definitions ────────────────────────────────────────────────────────
const CLASS_MAP = [
  { bit: 1,     abbr: 'WAR', fullName: 'Warrior' },
  { bit: 2,     abbr: 'CLR', fullName: 'Cleric' },
  { bit: 4,     abbr: 'PAL', fullName: 'Paladin' },
  { bit: 8,     abbr: 'RNG', fullName: 'Ranger' },
  { bit: 16,    abbr: 'SHD', fullName: 'Shadow Knight' },
  { bit: 32,    abbr: 'DRU', fullName: 'Druid' },
  { bit: 64,    abbr: 'MNK', fullName: 'Monk' },
  { bit: 128,   abbr: 'BRD', fullName: 'Bard' },
  { bit: 256,   abbr: 'ROG', fullName: 'Rogue' },
  { bit: 512,   abbr: 'SHM', fullName: 'Shaman' },
  { bit: 1024,  abbr: 'NEC', fullName: 'Necromancer' },
  { bit: 2048,  abbr: 'WIZ', fullName: 'Wizard' },
  { bit: 4096,  abbr: 'MAG', fullName: 'Magician' },
  { bit: 8192,  abbr: 'ENC', fullName: 'Enchanter' },
  { bit: 16384, abbr: 'BST', fullName: 'Beastlord' },
  { bit: 32768, abbr: 'BER', fullName: 'Berserker' },
]

const TOME_GRADES = ['Greater', 'Exalted', 'Ascendant']
const TOME_REGEX  = /Illegible Tome of (Greater|Exalted|Ascendant) (.+) Advancement/i

const isTome      = name => TOME_REGEX.test(name)
const getTomeGrade = name => { const m = name.match(TOME_REGEX); return m ? m[1] : null }
const getTomeClass = name => { const m = name.match(TOME_REGEX); return m ? m[2] : null }

// Given an AA ability, return the set of tome keys it belongs to: "Grade|ClassName"
function tomeKeysForAbility(ability) {
  return (ability.originalClassNames || []).map(cls => `${ability.tierName}|${cls}`)
}

function getClassNames(bitmask) {
  if (!bitmask || bitmask === 65535) return 'ALL'
  return CLASS_MAP.filter(c => bitmask & c.bit).map(c => c.abbr).join(' ') || 'NONE'
}

function getRaceNames(bitmask) {
  if (!bitmask || bitmask === 65535) return 'ALL'
  const raceMap = { 1:'HUM',2:'BAR',4:'ERU',8:'ELF',16:'HIE',32:'DEF',64:'HEF',128:'DWF',256:'TRL',512:'OGR',1024:'HFL',2048:'GNM',4096:'IKS',8192:'VAH',16384:'FRG' }
  return Object.entries(raceMap).filter(([bit]) => bitmask & parseInt(bit)).map(([,n]) => n).join(' ') || 'NONE'
}

function getSlotName(bitmask) {
  const slotMap = { 1:'Charm',4:'Head',8:'Face',32:'Neck',64:'Shoulders',128:'Arms',256:'Back',4096:'Hands',8192:'Primary',16384:'Secondary',131072:'Chest',262144:'Legs',524288:'Feet',1048576:'Waist',2048:'Range',4194304:'Ammo' }
  return Object.entries(slotMap).filter(([bit]) => bitmask & parseInt(bit)).map(([,n]) => n).join(', ') || 'None'
}

// ── Item extraction ──────────────────────────────────────────────────────────
function extractItems(character) {
  const items = []

  const processContainer = (container, containerSlot, isBank = false) => {
    if (!container) return
    const containerName = !isBank && container.name && container.name !== 'Backpack' && container.name !== 'Backpack*'
      ? container.name : null

    if (containerName) {
      items.push({ name: containerName, location: `${containerSlot} (${containerName})`, icon: container.icon, itemId: container.itemId })
    } else if (isBank && container.name && container.name !== 'Backpack' && container.name !== 'Backpack*') {
      items.push({ name: container.name, location: containerSlot, icon: container.icon, itemId: container.itemId })
    }

    if (container.contents) {
      container.contents.forEach(item => {
        if (item.name) {
          const isInventoryBag = container.slotId >= 23 && container.slotId <= 31
          let bagSlot
          if (isInventoryBag) {
            const bagBase = 4010 + (container.slotId - 23) * 200
            bagSlot = item.slotId - bagBase + 1
          } else {
            bagSlot = item.slotId
          }
          const loc = isBank
            ? `${containerSlot}, Slot ${bagSlot}`
            : containerName
              ? `${containerSlot} (${containerName}), Slot ${bagSlot}`
              : `${containerSlot}, Slot ${bagSlot}`
          items.push({ name: item.name, location: loc, icon: item.icon, itemId: item.itemId })
        }
      })
    }
  }

  if (character.inventory) character.inventory.forEach((slot, idx) => { if (slot) processContainer(slot, `Inv ${idx + 1}`, false) })
  if (character.bank)      character.bank.forEach((slot, idx)      => { if (slot) processContainer(slot, `Bank ${idx + 1}`, true) })
  return items
}

// ── Item Detail Modal ────────────────────────────────────────────────────────
function ItemModal({ itemId, onClose }) {
  const [item, setItem] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${ITEM_API}/${itemId}`, { signal: controller.signal })
      .then(r => r.json()).then(d => { setItem(d); setLoading(false) })
      .catch(() => setLoading(false))
    return () => controller.abort()
  }, [itemId])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const STATS = [
    ['AC','ac'],['HP','hp'],['Mana','mana'],['Endur','endur'],
    ['STR','astr'],['STA','asta'],['DEX','adex'],['AGI','aagi'],['INT','aint'],['WIS','awis'],['CHA','acha'],
    ['Haste','haste'],['Attack','attack'],['Regen','regen'],['Mana Regen','manaregen'],
    ['FR','fr'],['CR','cr'],['MR','mr'],['DR','dr'],['PR','pr'],
    ['H.STR','heroic_str'],['H.STA','heroic_sta'],['H.DEX','heroic_dex'],
    ['H.AGI','heroic_agi'],['H.INT','heroic_int'],['H.WIS','heroic_wis'],['H.CHA','heroic_cha'],
  ]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{loading ? 'Loading…' : (item?.Name ?? 'Unknown Item')}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {loading && <div className="modal-loading">Loading…</div>}
        {!loading && item && (
          <div className="modal-body">
            <div className="modal-identity">
              {item.icon && <img src={`${ICON_BASE}${item.icon}.png`} alt="" className="modal-icon" onError={e => { e.target.style.display='none' }} />}
              <div className="modal-meta">
                <div className="modal-item-name">{item.Name}</div>
                <div className="modal-detail-line"><span className="modal-detail-label">Class: </span>{getClassNames(item.classes)}</div>
                <div className="modal-detail-line"><span className="modal-detail-label">Race: </span>{getRaceNames(item.races)}</div>
                {item.slots > 0 && <div className="modal-detail-line"><span className="modal-detail-label">Slot: </span>{getSlotName(item.slots)}</div>}
                {item.reqlevel > 0 && <div className="modal-detail-line"><span className="modal-detail-label">Req Level: </span>{item.reqlevel}</div>}
              </div>
            </div>
            {STATS.some(([,key]) => item[key] > 0) && (
              <div className="modal-stats">
                {STATS.filter(([,key]) => item[key] > 0).map(([label,key]) => (
                  <div key={key} className="modal-stat">
                    <span className="modal-stat-label">{label}</span>
                    <span className="modal-stat-value">+{item[key]}</span>
                  </div>
                ))}
              </div>
            )}
            {item.damage > 0 && (
              <div className="modal-weapon">
                {item.damage}/{item.delay} ({Math.round((item.damage / item.delay) * 100) / 100} ratio)
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── AA Picker Modal ──────────────────────────────────────────────────────────
function AAPickerModal({ abilities, selectedAAs, onToggleAA, onClose, lastSynced, onResync, resyncing }) {
  const [search, setSearch] = useState('')
  const [filterClass, setFilterClass] = useState(null)  // fullName string
  const [filterGrade, setFilterGrade] = useState(null)
  const [relativeTime, setRelativeTime] = useState(() => formatRelativeTime(lastSynced))

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Tick the relative timestamp every 30s
  useEffect(() => {
    setRelativeTime(formatRelativeTime(lastSynced))
    const id = setInterval(() => setRelativeTime(formatRelativeTime(lastSynced)), 30_000)
    return () => clearInterval(id)
  }, [lastSynced])

  const filtered = useMemo(() => {
    return abilities.filter(a => {
      if (filterClass && !a.originalClassNames.includes(filterClass)) return false
      if (filterGrade && a.tierName !== filterGrade) return false
      if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [abilities, filterClass, filterGrade, search])

  // Get classes that have abilities in current grade filter
  const availableClasses = useMemo(() => {
    const src = filterGrade ? abilities.filter(a => a.tierName === filterGrade) : abilities
    const set = new Set()
    src.forEach(a => a.originalClassNames.forEach(c => set.add(c)))
    return CLASS_MAP.filter(c => set.has(c.fullName))
  }, [abilities, filterGrade])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="aa-picker-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Select AAs to Track</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="aa-picker-filters">
          <input
            className="aa-search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search abilities…"
            autoFocus
          />
          <div className="aa-filter-row">
            {TOME_GRADES.map(g => (
              <button
                key={g}
                className={`filter-btn ${filterGrade === g ? 'active' : ''}`}
                onClick={() => setFilterGrade(filterGrade === g ? null : g)}
              >{g}</button>
            ))}
          </div>
          <div className="aa-filter-row">
            {availableClasses.map(c => (
              <button
                key={c.abbr}
                className={`filter-btn ${filterClass === c.fullName ? 'active' : ''}`}
                onClick={() => setFilterClass(filterClass === c.fullName ? null : c.fullName)}
                title={c.fullName}
              >{c.abbr}</button>
            ))}
          </div>
        </div>

        <div className="aa-picker-body">
          {filtered.length === 0 && <div className="aa-empty">No abilities match</div>}
          {filtered.map(a => (
            <div
              key={a.universalId}
              className={`aa-row ${selectedAAs.has(a.universalId) ? 'selected' : ''}`}
              onClick={() => onToggleAA(a)}
            >
              <div className="aa-row-check">{selectedAAs.has(a.universalId) ? '✓' : ''}</div>
              <div className="aa-row-info">
                <span className="aa-row-name">{a.name}</span>
                <span className="aa-row-meta">
                  <span className={`aa-grade-tag grade-${a.tierName.toLowerCase()}`}>{a.tierName}</span>
                  {a.originalClassNames.join(', ')}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="aa-picker-footer">
          <div className="aa-sync-info">
            {relativeTime && <span className="aa-sync-label">Synced {relativeTime}</span>}
            <button className="aa-resync-btn" onClick={onResync} disabled={resyncing}>
              {resyncing ? 'Syncing…' : '↻ Re-sync'}
            </button>
          </div>
          {selectedAAs.size > 0 && (
            <span className="aa-selected-count">{selectedAAs.size} selected</span>
          )}
          <button className="aa-done-btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}

// ── Filter toolbar ───────────────────────────────────────────────────────────
function FilterToolbar({
  tomeMode, onToggleTomeMode,
  selectedClasses, onToggleClass,
  selectedGrades, onToggleGrade,
  selectedAAs, onOpenAAPickeer, onClearAAs,
  aaLoading, requiredTomeKeys,
  itemFilter, onItemFilterChange,
  totalFiltered,
}) {
  return (
    <div className="filter-toolbar">
      {/* ── Top row: Tome toggle + grade pills + item search + count ── */}
      <div className="filter-toolbar-row filter-toolbar-top">
        <button className={`tome-toggle ${tomeMode ? 'active' : ''}`} onClick={onToggleTomeMode}>
          Tome Mode
        </button>

        {tomeMode && (
          <>
            <div className="filter-divider" />
            <div className="filter-group">
              {TOME_GRADES.map(grade => (
                <button
                  key={grade}
                  className={`filter-btn ${selectedGrades.has(grade) ? 'active' : ''}`}
                  onClick={() => onToggleGrade(grade)}
                >{grade}</button>
              ))}
            </div>
          </>
        )}

        <div className="filter-toolbar-right">
          <input
            className="item-search-input"
            value={itemFilter}
            onChange={e => onItemFilterChange(e.target.value)}
            placeholder="Filter items…"
          />
          <span className="row-count">{totalFiltered} item{totalFiltered !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {tomeMode && (
        <>
          <div className="filter-toolbar-row">
            <div className="filter-group">
              {CLASS_MAP.map(c => (
                <button
                  key={c.abbr}
                  className={`filter-btn ${selectedClasses.has(c.abbr) ? 'active' : ''}`}
                  onClick={() => onToggleClass(c.abbr)}
                  title={c.fullName}
                >{c.abbr}</button>
              ))}
            </div>
          </div>

          <div className="filter-toolbar-row filter-toolbar-aa">
            <button className="aa-picker-btn" onClick={onOpenAAPickeer} disabled={aaLoading}>
              {aaLoading ? 'Loading AAs…' : '+ Select AAs'}
            </button>
            {selectedAAs.size > 0 && (
              <>
                <span className="aa-active-label">{selectedAAs.size} AA{selectedAAs.size !== 1 ? 's' : ''}</span>
                <span className="aa-arrow">→</span>
                {[...requiredTomeKeys].sort().map(key => {
                  const [grade, cls] = key.split('|')
                  return (
                    <span key={key} className={`aa-tome-tag grade-${grade.toLowerCase()}`}>
                      {grade} {cls}
                    </span>
                  )
                })}
                <button className="aa-clear-btn" onClick={onClearAAs}>Clear</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Table column definition ──────────────────────────────────────────────────
function makeColumns(onItemClick) {
  const columnHelper = createColumnHelper()
  return [
    {
      id: 'expand',
      header: '',
      cell: ({ row }) => (
        <button className="expand-btn" onClick={() => row.toggleExpanded()}>
          {row.getIsExpanded() ? '▼' : '▶'}
        </button>
      ),
      size: 36,
      enableSorting: false,
      enableColumnFilter: false,
    },
    columnHelper.accessor('itemName', {
      header: 'Item',
      size: 320,
      cell: info => (
        <div className="item-name-cell">
          {info.row.original.icon && (
            <img src={`${ICON_BASE}${info.row.original.icon}.png`} alt="" className="item-icon" />
          )}
          <button className="item-name-btn" onClick={() => onItemClick(info.row.original.itemId)}>
            {info.getValue()}
          </button>
        </div>
      ),
    }),
    columnHelper.accessor('totalQty', {
      header: 'Qty',
      size: 80,
      enableColumnFilter: false,
      cell: info => <span className="qty-plain">{info.getValue()}</span>,
    }),
  ]
}


function InventoryTable({ rows, onItemClick, itemFilter, onFilteredCountChange }) {
  const [sorting, setSorting] = useState([{ id: 'totalQty', desc: true }])
  const [expanded, setExpanded] = useState({})
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 50 })

  const columns = useMemo(() => makeColumns(onItemClick), [onItemClick])

  // Apply the external item name filter directly on rows
  const filteredRows = useMemo(() => {
    if (!itemFilter) return rows
    const q = itemFilter.toLowerCase()
    return rows.filter(r => r.itemName.toLowerCase().includes(q))
  }, [rows, itemFilter])

  const table = useReactTable({
    data: filteredRows, columns,
    state: { sorting, expanded, pagination },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    autoResetPageIndex: false,
    getRowCanExpand: () => true,
  })

  // Notify parent of filtered count for display in toolbar
  const totalFiltered = filteredRows.length
  useEffect(() => { onFilteredCountChange(totalFiltered) }, [totalFiltered, onFilteredCountChange])

  return (
    <div>
      <div className="table-wrap">
        <table className="items-table">
          <thead>
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>
                {hg.headers.map(header => (
                  <th
                    key={header.id}
                    style={{ width: header.column.getSize() }}
                    className={header.column.getCanSort() ? 'sortable' : ''}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="th-content">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === 'asc'  && <span className="sort-indicator"> ▲</span>}
                      {header.column.getIsSorted() === 'desc' && <span className="sort-indicator"> ▼</span>}
                      {header.column.getCanSort() && !header.column.getIsSorted() && <span className="sort-indicator muted"> ⇅</span>}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map(row => (
              <Fragment key={row.id}>
                <tr className="main-row">
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                  ))}
                </tr>
                {row.getIsExpanded() && (
                  <tr className="detail-row">
                    <td colSpan={3}>
                      <div className="detail-pills">
                        {row.original.owners.map(o => (
                          <div key={o.owner} className="detail-pill">
                            <div className="detail-pill-name">{o.owner}</div>
                            {Object.entries(
                              o.locations.reduce((acc, loc) => { acc[loc] = (acc[loc] || 0) + 1; return acc }, {})
                            ).map(([loc, qty], i) => (
                              <div key={i} className="detail-pill-loc">
                                <span className="detail-pill-qty">{qty}</span>
                                <span className="detail-pill-sep">|</span>
                                <span>{loc}</span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <button onClick={() => table.firstPage()}    disabled={!table.getCanPreviousPage()}>«</button>
        <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>‹</button>
        <span className="page-info">Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}</span>
        <button onClick={() => table.nextPage()}  disabled={!table.getCanNextPage()}>›</button>
        <button onClick={() => table.lastPage()}  disabled={!table.getCanNextPage()}>»</button>
        <select value={table.getState().pagination.pageSize} onChange={e => table.setPageSize(Number(e.target.value))}>
          {[25, 50, 100, 250].map(size => <option key={size} value={size}>Show {size}</option>)}
        </select>
      </div>
    </div>
  )
}

const LS_KEY     = 'asc-tracker-characters'
const LS_AA_KEY  = 'asc-tracker-aa-cache'

function formatRelativeTime(isoString) {
  if (!isoString) return null
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000)
  if (diff < 60)   return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// ── App ──────────────────────────────────────────────────────────────────────
function App() {
  const [inputName, setInputName] = useState('')
  const [characters, setCharacters] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || '[]')
      return saved.map(name => ({ name, loading: true, error: null, data: null }))
    } catch { return [] }
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [tomeMode, setTomeMode] = useState(true)
  const [selectedClasses, setSelectedClasses] = useState(new Set())
  const [selectedGrades, setSelectedGrades] = useState(new Set())

  // AA picker
  const [aaAbilities, setAaAbilities] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_AA_KEY))?.abilities || [] } catch { return [] }
  })
  const [aaLastSynced, setAaLastSynced] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_AA_KEY))?.syncedAt || null } catch { return null }
  })
  const [aaLoading, setAaLoading] = useState(false)
  const [showAAPicker, setShowAAPicker] = useState(false)
  const [selectedAAs, setSelectedAAs] = useState(new Set()) // universalIds

  // Item name filter (lives in toolbar, applied by InventoryTable)
  const [itemFilter, setItemFilter] = useState('')
  const [filteredCount, setFilteredCount] = useState(0)

  // Item modal
  const [selectedItemId, setSelectedItemId] = useState(null)

  // Persist names to localStorage whenever the list changes
  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(characters.map(c => c.name)))
  }, [characters])

  // On mount, fetch data for any restored characters
  useEffect(() => {
    characters.forEach(c => { if (c.loading) fetchCharacter(c.name) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchCharacter = async name => {
    try {
      const res = await fetch(`${API_BASE}/${name}`)
      if (!res.ok) throw new Error(res.status === 404 ? 'Character not found' : 'Failed to fetch character')
      const data = await res.json()
      setCharacters(prev => prev.map(c => c.name === name ? { name, loading: false, error: null, data } : c))
    } catch (err) {
      setCharacters(prev => prev.map(c => c.name === name ? { name, loading: false, error: err.message, data: null } : c))
    }
  }

  const addCharacter = async () => {
    const name = inputName.trim()
    if (!name) return
    if (characters.find(c => c.name.toLowerCase() === name.toLowerCase())) {
      setError('Character already added')
      setTimeout(() => setError(''), 2000)
      return
    }
    setLoading(true); setError('')
    setCharacters(prev => [...prev, { name, loading: true, error: null, data: null }])
    setInputName('')
    await fetchCharacter(name)
    setLoading(false)
  }

  const removeCharacter = name => setCharacters(prev => prev.filter(c => c.name !== name))

  const toggleClass = abbr => setSelectedClasses(prev => { const s = new Set(prev); s.has(abbr) ? s.delete(abbr) : s.add(abbr); return s })
  const toggleGrade = grade => setSelectedGrades(prev => { const s = new Set(prev); s.has(grade) ? s.delete(grade) : s.add(grade); return s })

  const handleToggleTomeMode = () => {
    setTomeMode(v => !v)
    setSelectedClasses(new Set())
    setSelectedGrades(new Set())
    setSelectedAAs(new Set())
  }

  const handleToggleAA = useCallback(ability => {
    setSelectedAAs(prev => {
      const s = new Set(prev)
      s.has(ability.universalId) ? s.delete(ability.universalId) : s.add(ability.universalId)
      return s
    })
  }, [])

  const fetchAndCacheAAs = async () => {
    setAaLoading(true)
    try {
      const res = await fetch(AA_API)
      const data = await res.json()
      const abilities = data.abilities || []
      const syncedAt = new Date().toISOString()
      setAaAbilities(abilities)
      setAaLastSynced(syncedAt)
      localStorage.setItem(LS_AA_KEY, JSON.stringify({ abilities, syncedAt }))
    } catch (e) {
      console.error('Failed to load AAs', e)
    } finally {
      setAaLoading(false)
    }
  }

  const handleOpenAAPicker = async () => {
    // Only fetch from network if we have no cached data
    if (aaAbilities.length === 0) await fetchAndCacheAAs()
    setShowAAPicker(true)
  }

  // Build a lookup: universalId → set of tome keys "Grade|ClassName"
  const aaToTomeKeys = useMemo(() => {
    const map = new Map()
    aaAbilities.forEach(a => {
      map.set(a.universalId, tomeKeysForAbility(a))
    })
    return map
  }, [aaAbilities])

  // Set of tome keys that the selected AAs require
  const requiredTomeKeys = useMemo(() => {
    const keys = new Set()
    selectedAAs.forEach(id => {
      const tKeys = aaToTomeKeys.get(id) || []
      tKeys.forEach(k => keys.add(k))
    })
    return keys
  }, [selectedAAs, aaToTomeKeys])

  const allRows = useMemo(() => {
    const byItem = new Map()
    characters.filter(c => c.data).forEach(c => {
      extractItems(c.data).forEach(item => {
        if (!byItem.has(item.name)) {
          byItem.set(item.name, { itemName: item.name, icon: item.icon, itemId: item.itemId, totalQty: 0, owners: new Map() })
        }
        const row = byItem.get(item.name)
        row.totalQty++
        if (!row.owners.has(c.data.name)) row.owners.set(c.data.name, { owner: c.data.name, count: 0, locations: [] })
        const o = row.owners.get(c.data.name)
        o.count++
        o.locations.push(item.location)
      })
    })
    return Array.from(byItem.values()).map(row => ({
      itemName: row.itemName, icon: row.icon, itemId: row.itemId,
      totalQty: row.totalQty, owners: Array.from(row.owners.values()),
    }))
  }, [characters])

  const tableRows = useMemo(() => {
    if (!tomeMode) return allRows

    return allRows.filter(row => {
      if (!isTome(row.itemName)) return false

      // AA filter takes priority if any AAs are selected
      if (requiredTomeKeys.size > 0) {
        const grade = getTomeGrade(row.itemName)
        const cls   = getTomeClass(row.itemName)
        return requiredTomeKeys.has(`${grade}|${cls}`)
      }

      if (selectedGrades.size > 0 && !selectedGrades.has(getTomeGrade(row.itemName))) return false
      if (selectedClasses.size > 0) {
        const tomeClass = getTomeClass(row.itemName)
        const anyMatch = [...selectedClasses].some(abbr => {
          const cls = CLASS_MAP.find(c => c.abbr === abbr)
          return cls && tomeClass && tomeClass.toLowerCase().includes(cls.fullName.toLowerCase())
        })
        if (!anyMatch) return false
      }
      return true
    })
  }, [allRows, tomeMode, selectedClasses, selectedGrades, requiredTomeKeys])

  const hasData = characters.some(c => c.data)

  return (
    <div className="container">
      <h1>Ascendant Inventory Tracker</h1>

      <div className="controls">
        <input
          type="text" value={inputName}
          onChange={e => setInputName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addCharacter()}
          placeholder="Enter character name…"
        />
        <button onClick={addCharacter} disabled={loading || !inputName.trim()}>Add Character</button>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="pills">
        {characters.map(c => (
          <div key={c.name} className={`pill ${c.loading ? 'loading' : ''} ${c.error ? 'error' : ''}`}>
            {c.loading && <span className="loading-spinner" />}
            {c.error ? `${c.name} (Error)` : c.name}
            <button onClick={() => removeCharacter(c.name)}>×</button>
          </div>
        ))}
      </div>

      {characters.length === 0 && <div className="empty-state"><p>Enter character names above to track their inventory</p></div>}
      {characters.length > 0 && !hasData && <div className="empty-state"><p>Add a character to see their items</p></div>}

      {hasData && (
        <>
          <FilterToolbar
            tomeMode={tomeMode}         onToggleTomeMode={handleToggleTomeMode}
            selectedClasses={selectedClasses} onToggleClass={toggleClass}
            selectedGrades={selectedGrades}   onToggleGrade={toggleGrade}
            selectedAAs={selectedAAs}
            onOpenAAPickeer={handleOpenAAPicker}
            onClearAAs={() => setSelectedAAs(new Set())}
            aaLoading={aaLoading}
            requiredTomeKeys={requiredTomeKeys}
            itemFilter={itemFilter}
            onItemFilterChange={v => { setItemFilter(v) }}
            totalFiltered={filteredCount}
          />

          <InventoryTable
            rows={tableRows}
            onItemClick={setSelectedItemId}
            itemFilter={itemFilter}
            onFilteredCountChange={setFilteredCount}
          />
        </>
      )}

      {selectedItemId && <ItemModal itemId={selectedItemId} onClose={() => setSelectedItemId(null)} />}

      {showAAPicker && (
        <AAPickerModal
          abilities={aaAbilities}
          selectedAAs={selectedAAs}
          onToggleAA={handleToggleAA}
          onClose={() => setShowAAPicker(false)}
          lastSynced={aaLastSynced}
          onResync={fetchAndCacheAAs}
          resyncing={aaLoading}
        />
      )}
    </div>
  )
}

export default App
