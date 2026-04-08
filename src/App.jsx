import { useState, useMemo, useEffect, useCallback, useRef, Fragment } from 'react'
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
      items.push({ name: containerName, location: `${containerSlot} (${containerName})`, icon: container.icon, itemId: container.itemId, qty: container.charges || 1 })
    } else if (isBank && container.name && container.name !== 'Backpack' && container.name !== 'Backpack*') {
      items.push({ name: container.name, location: containerSlot, icon: container.icon, itemId: container.itemId, qty: container.charges || 1 })
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
          items.push({ name: item.name, location: loc, icon: item.icon, itemId: item.itemId, qty: item.charges || 1 })
        }
      })
    }
  }

  if (character.inventory) character.inventory.forEach((slot, idx) => { if (slot) processContainer(slot, `Inv ${idx + 1}`, false) })
  if (character.bank)      character.bank.forEach((slot, idx)      => { if (slot) processContainer(slot, `Bank ${idx + 1}`, true) })
  return items
}

// ── Item Detail Modal ────────────────────────────────────────────────────────
const SIZE_NAMES = ['TINY', 'SMALL', 'MEDIUM', 'LARGE', 'GIANT']
const EFFECT_TYPE_LABELS = {
  proc: 'Combat Proc', click: 'Click Effect', worn: 'Worn Effect',
  focus: 'Focus Effect', scroll: 'Scroll Effect', bard: 'Bard Effect',
}

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

  const renderStat = ({ label, value, cls }, i) => (
    <div key={i} className="msr">
      <span className="msr-label">{label}</span>
      <span className={`msr-value ${cls || ''}`}>{value}</span>
    </div>
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{loading ? 'Loading…' : (item?.Name ?? 'Unknown Item')}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {loading && <div className="modal-loading">Loading…</div>}
        {!loading && item && (() => {
          const flags = [item.magic && 'Magic', item.nodrop && 'No Trade', item.norent && 'No Rent'].filter(Boolean)

          // Left col: size/weight + primary stats
          const leftStats = [
            { label: 'Size',        value: SIZE_NAMES[item.size] ?? item.size, cls: 'sv-plain' },
            { label: 'Weight',      value: (item.weight / 10).toFixed(1),      cls: 'sv-plain' },
            item.astr  > 0 && { label: 'Strength',     value: `+${item.astr}`,  cls: 'sv-green' },
            item.asta  > 0 && { label: 'Stamina',      value: `+${item.asta}`,  cls: 'sv-green' },
            item.adex  > 0 && { label: 'Dexterity',    value: `+${item.adex}`,  cls: 'sv-green' },
            item.aagi  > 0 && { label: 'Agility',      value: `+${item.aagi}`,  cls: 'sv-green' },
            item.aint  > 0 && { label: 'Intelligence', value: `+${item.aint}`,  cls: 'sv-green' },
            item.awis  > 0 && { label: 'Wisdom',       value: `+${item.awis}`,  cls: 'sv-green' },
            item.acha  > 0 && { label: 'Charisma',     value: `+${item.acha}`,  cls: 'sv-green' },
            item.avoidance   > 0 && { label: 'Avoidance',   value: `+${item.avoidance}`,   cls: 'sv-green' },
            item.accuracy    > 0 && { label: 'Accuracy',    value: `+${item.accuracy}`,    cls: 'sv-green' },
            item.backstabdmg > 0 && { label: 'Backstab',    value: `+${item.backstabdmg}`, cls: 'sv-green' },
            item.spelldmg    > 0 && { label: 'Spell Dmg',   value: `+${item.spelldmg}`,    cls: 'sv-green' },
            item.healamt     > 0 && { label: 'Heal Amt',    value: `+${item.healamt}`,      cls: 'sv-green' },
            item.clairvoyance> 0 && { label: 'Clairvoyance',value: `+${item.clairvoyance}`,cls: 'sv-green' },
          ].filter(Boolean)

          // Right col: defensive + resists
          const rightStats = [
            item.ac       > 0 && { label: 'AC',         value: item.ac,              cls: 'sv-plain' },
            item.hp       > 0 && { label: 'HP',         value: item.hp,              cls: 'sv-plain' },
            item.mana     > 0 && { label: 'Mana',       value: item.mana,            cls: 'sv-plain' },
            item.endur    > 0 && { label: 'End',        value: item.endur,           cls: 'sv-plain' },
            item.attack   > 0 && { label: 'Attack',     value: `+${item.attack}`,    cls: 'sv-green' },
            item.haste    > 0 && { label: 'Haste',      value: `+${item.haste}%`,    cls: 'sv-green' },
            item.regen    > 0 && { label: 'HP Regen',   value: `+${item.regen}`,     cls: 'sv-green' },
            item.manaregen> 0 && { label: 'Mana Regen', value: `+${item.manaregen}`, cls: 'sv-green' },
            item.fr > 0 && { label: 'Fire',    value: `+${item.fr}`, cls: 'sv-resist' },
            item.cr > 0 && { label: 'Cold',    value: `+${item.cr}`, cls: 'sv-resist' },
            item.mr > 0 && { label: 'Magic',   value: `+${item.mr}`, cls: 'sv-resist' },
            item.dr > 0 && { label: 'Disease', value: `+${item.dr}`, cls: 'sv-resist' },
            item.pr > 0 && { label: 'Poison',  value: `+${item.pr}`, cls: 'sv-resist' },
          ].filter(Boolean)

          const heroicStats = [
            item.heroic_str > 0 && { label: 'H.Str', value: `+${item.heroic_str}`, cls: 'sv-heroic' },
            item.heroic_sta > 0 && { label: 'H.Sta', value: `+${item.heroic_sta}`, cls: 'sv-heroic' },
            item.heroic_dex > 0 && { label: 'H.Dex', value: `+${item.heroic_dex}`, cls: 'sv-heroic' },
            item.heroic_agi > 0 && { label: 'H.Agi', value: `+${item.heroic_agi}`, cls: 'sv-heroic' },
            item.heroic_int > 0 && { label: 'H.Int', value: `+${item.heroic_int}`, cls: 'sv-heroic' },
            item.heroic_wis > 0 && { label: 'H.Wis', value: `+${item.heroic_wis}`, cls: 'sv-heroic' },
            item.heroic_cha > 0 && { label: 'H.Cha', value: `+${item.heroic_cha}`, cls: 'sv-heroic' },
          ].filter(Boolean)

          const hasStats = leftStats.length > 2 || rightStats.length > 0 // >2 because size+weight always present
          const hasWeapon = item.damage > 0
          const hasEffects = item.itemEffects && item.itemEffects.length > 0

          return (
            <div className="modal-body">
              {/* Description */}
              <div className="modal-section modal-desc">
                <div className="modal-section-hdr">Description</div>
                <div className="modal-identity">
                  {item.icon && (
                    <img src={`${ICON_BASE}${item.icon}.png`} alt="" className="modal-icon"
                      onError={e => { e.target.style.display = 'none' }} />
                  )}
                  <div className="modal-meta">
                    <div className="modal-item-name">{item.Name}</div>
                    {flags.length > 0 && <div className="modal-flags">{flags.join(', ')}</div>}
                    {item.classes > 0 && item.classes !== 65535 && (
                      <div className="modal-detail-line">
                        <span className="modal-detail-label">Class: </span>
                        <span className="modal-detail-val">{getClassNames(item.classes)}</span>
                      </div>
                    )}
                    {item.races > 0 && (
                      <div className="modal-detail-line">
                        <span className="modal-detail-label">Race: </span>
                        <span className="modal-detail-val">{getRaceNames(item.races)}</span>
                      </div>
                    )}
                    {item.slots > 0 && (
                      <div className="modal-detail-line modal-slot-line">{getSlotName(item.slots)}</div>
                    )}
                    {(item.reqlevel > 0 || item.reclevel > 0) && (
                      <div className="modal-detail-line">
                        {item.reqlevel > 0 && <><span className="modal-detail-label">Req Lv: </span><span className="modal-detail-val">{item.reqlevel}</span></>}
                        {item.reqlevel > 0 && item.reclevel > 0 && <span className="modal-detail-label">  /  Rec Lv: </span>}
                        {item.reclevel > 0 && <span className="modal-detail-val">{item.reclevel}</span>}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Stats */}
              {hasStats && (
                <div className="modal-section modal-stats-section">
                  <div className="modal-stats-grid">
                    <div className="modal-stats-col">{leftStats.map(renderStat)}</div>
                    <div className="modal-stats-col">{rightStats.map(renderStat)}</div>
                  </div>
                  {heroicStats.length > 0 && (
                    <div className="modal-heroic-row">
                      {heroicStats.map(renderStat)}
                    </div>
                  )}
                </div>
              )}

              {/* Weapon */}
              {hasWeapon && (
                <div className="modal-section modal-weapon-section">
                  <div className="modal-stats-grid">
                    <div className="msr">
                      <span className="msr-label">Damage</span>
                      <span className="msr-value sv-plain">{item.damage}</span>
                    </div>
                    <div className="msr">
                      <span className="msr-label">Delay</span>
                      <span className="msr-value sv-plain">{item.delay}</span>
                    </div>
                  </div>
                  <div className="msr modal-ratio-row">
                    <span className="msr-label">Ratio</span>
                    <span className="msr-value sv-ratio">{(item.damage / item.delay).toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Effects */}
              {hasEffects && (
                <div className="modal-section modal-effects-section">
                  {item.itemEffects.map((eff, i) => (
                    <div key={i} className="modal-effect-row">
                      <span className="modal-detail-label">{EFFECT_TYPE_LABELS[eff.effect_type] ?? eff.effect_type}: </span>
                      <span className="modal-effect-name">{eff.spell_name}</span>
                      {eff.level > 0 && <span className="modal-effect-level"> (Lv.{eff.level})</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })()}
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
      if (search) {
        const q = search.toLowerCase()
        const matchesName = a.name.toLowerCase().includes(q)
        const matchesDesc = a.description && a.description.toLowerCase().includes(q)
        if (!matchesName && !matchesDesc) return false
      }
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
                {a.description && <span className="aa-row-desc">{a.description}</span>}
                {a.effectSummary && a.effectSummary.length > 0 && (
                  <div className="aa-row-effects">
                    {a.effectSummary.map((e, i) => (
                      <span key={i} className="aa-row-effect">
                        {e.effectDesc}{e.range ? <span className="aa-row-effect-range"> {e.range}</span> : null}
                      </span>
                    ))}
                  </div>
                )}
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

// ── Character Planner Modal ──────────────────────────────────────────────────
function CharacterPlannerModal({
  characterName, aaPlans, setAaPlans, aaAbilities, aaLoading, fetchAndCacheAAs, aaLastSynced, onClose, focusedPlannerTomes
}) {
  const [showPicker, setShowPicker] = useState(false)

  // Open the picker
  const handleOpenPicker = async () => {
    if (aaAbilities.length === 0) await fetchAndCacheAAs()
    setShowPicker(true)
  }

  // The character's current plan: { [universalId]: { [className]: points } }
  const plan = aaPlans[characterName] || {}
  const planIds = new Set(Object.keys(plan).map(Number))

  // When AAPickerModal toggles an AA
  const handleToggleAA = (ability) => {
    setAaPlans(prev => {
      const charPlan = prev[characterName] || {}
      if (charPlan[ability.universalId]) {
        // Remove it
        const newPlan = { ...charPlan }
        delete newPlan[ability.universalId]
        return { ...prev, [characterName]: newPlan }
      } else {
        // Add it with default points for each class
        const classRanks = {}
        ability.originalClassNames.forEach(c => classRanks[c] = ability.totalRanks)
        return { ...prev, [characterName]: { ...charPlan, [ability.universalId]: classRanks } }
      }
    })
  }

  // Handle points change
  const handleChangePoints = (universalId, className, points) => {
    setAaPlans(prev => {
      const charPlan = prev[characterName] || {}
      const abilityPlan = charPlan[universalId] || {}
      return {
        ...prev,
        [characterName]: {
          ...charPlan,
          [universalId]: { ...abilityPlan, [className]: points }
        }
      }
    })
  }

  // Handle row deletion
  const handleDeleteClassRow = (universalId, className) => {
    setAaPlans(prev => {
      const charPlan = { ...(prev[characterName] || {}) }
      const abilityPlan = { ...(charPlan[universalId] || {}) }
      delete abilityPlan[className]

      // If no more classes for this AA, remove the AA entirely
      if (Object.keys(abilityPlan).length === 0) {
        delete charPlan[universalId]
      } else {
        charPlan[universalId] = abilityPlan
      }
      return { ...prev, [characterName]: charPlan }
    })
  }

  // Build a lookup: universalId → set of tome keys "Grade|ClassName"
  const aaToTomeKeys = useMemo(() => {
    const onKey = e => { if (e.key === 'Escape' && !showPicker) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, showPicker])

  // Get the rich objects for the list
  const plannedAAs = useMemo(() => {
    return Object.entries(plan).map(([uIdStr, classMap]) => {
      return { ability: aaAbilities.find(a => a.universalId === Number(uIdStr)), classMap }
    }).filter(x => x.ability)
  }, [plan, aaAbilities])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="planner-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{characterName}'s AA Plan</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="planner-body">
          <div className="planner-toolbar">
            <button className="add-aa-btn" onClick={handleOpenPicker} disabled={aaLoading}>
              {aaLoading ? 'Loading AAs…' : '+ Add Abilities to Plan'}
            </button>
            <span className="planner-hint">Abilities stack per-class on Ascendant</span>
          </div>

          <div className="planner-aa-list">
            {plannedAAs.length === 0 && <div className="planner-empty">No abilities planned yet.</div>}
            {plannedAAs.map(({ ability, classMap }) => (
              Object.entries(classMap).map(([cls, pts]) => (
                <div key={`${ability.universalId}-${cls}`} className="planner-row">
                  <div className="planner-row-info">
                    <span className="planner-row-name">{ability.name}</span>
                    <span className="planner-row-class">({cls})</span>
                  </div>
                  <div className="planner-row-controls">
                    <label>Target Pts:</label>
                    <input
                      type="number"
                      min="0"
                      value={pts}
                      onChange={e => handleChangePoints(ability.universalId, cls, parseInt(e.target.value) || 0)}
                    />
                    <button className="planner-del-btn" onClick={() => handleDeleteClassRow(ability.universalId, cls)}>×</button>
                  </div>
                </div>
              ))
            ))}
          </div>

          <div className="planner-summary">
            <h3>Tomes Required</h3>
            {focusedPlannerTomes.size === 0 && <span className="planner-empty-hint">Select abilities and set points to see requirements.</span>}
            <div className="planner-tome-grid">
              {[...focusedPlannerTomes].sort().map(([key, pts]) => {
                const [grade, cls] = key.split('|')
                return (
                  <div key={key} className="planner-tome-item">
                    <span className={`aa-tome-tag grade-${grade.toLowerCase()}`}>{grade} {cls}</span>
                    <span className="planner-tome-qty">x{pts}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {showPicker && (
        <AAPickerModal
          abilities={aaAbilities}
          selectedAAs={planIds}
          onToggleAA={handleToggleAA}
          onClose={() => setShowPicker(false)}
          lastSynced={aaLastSynced}
          onResync={fetchAndCacheAAs}
          resyncing={aaLoading}
        />
      )}
    </div>
  )
}

// ── Filter toolbar ───────────────────────────────────────────────────────────
function FilterToolbar({
  tomeMode, onToggleTomeMode,
  selectedClasses, onToggleClass,
  selectedGrades, onToggleGrade,
  selectedAAs, onOpenAAPickeer, onClearAAs, onRemoveAA,
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

        <span className="row-count">{totalFiltered} item{totalFiltered !== 1 ? 's' : ''}</span>
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
            {selectedAAs.length > 0 && (
              <>
                <div className="aa-active-list">
                  {selectedAAs.map(a => (
                    <span key={a.universalId} className="aa-selected-pill">
                      {a.name}
                      <button onClick={() => onRemoveAA(a.universalId)}>×</button>
                    </span>
                  ))}
                </div>
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

      <div className="filter-toolbar-row filter-toolbar-search">
        <input
          className="item-search-input"
          value={itemFilter}
          onChange={e => onItemFilterChange(e.target.value)}
          placeholder="Filter items…"
        />
      </div>
    </div>
  )
}

// ── AA chip with hover tooltip ───────────────────────────────────────────────
function AAChip({ ability }) {
  const [tipStyle, setTipStyle] = useState(null)
  const chipRef = useRef(null)

  const showTip = () => {
    const rect = chipRef.current.getBoundingClientRect()
    setTipStyle({
      position: 'fixed',
      left: Math.min(rect.left, window.innerWidth - 330),
      bottom: window.innerHeight - rect.top + 6,
    })
  }
  const hideTip = () => setTipStyle(null)

  return (
    <span
      ref={chipRef}
      className="aa-chip"
      onMouseEnter={showTip}
      onMouseLeave={hideTip}
      onClick={e => { e.stopPropagation(); tipStyle ? hideTip() : showTip() }}
    >
      <span className={`aa-chip-grade grade-${ability.tierName.toLowerCase()}`}>
        {ability.tierName[0]}
      </span>
      <span className="aa-chip-name">{ability.name}</span>
      {tipStyle && (
        <span className="aa-chip-tooltip" style={tipStyle} onClick={e => e.stopPropagation()}>
          <span className="aa-chip-tooltip-name">{ability.name}</span>
          {ability.description && (
            <span className="aa-chip-tooltip-desc">{ability.description}</span>
          )}
          {ability.effectSummary && ability.effectSummary.length > 0 && (
            <span className="aa-chip-tooltip-effects">
              {ability.effectSummary.map((ef, i) => (
                <span key={i} className="aa-chip-tooltip-effect">
                  {ef.effectDesc}
                  {ef.range && <span className="aa-chip-tooltip-range"> {ef.range}</span>}
                </span>
              ))}
            </span>
          )}
        </span>
      )}
    </span>
  )
}

// ── Table column definition ──────────────────────────────────────────────────
function makeColumns(onItemClick, isPlannerMode) {
  const columnHelper = createColumnHelper()
  const baseColumns = [
    {
      id: 'expand',
      header: '',
      cell: ({ row }) => (
        <button className="expand-btn" onClick={(e) => { e.stopPropagation(); row.toggleExpanded(); }}>
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
      cell: info => {
        const { icon, itemId, abilities } = info.row.original
        return (
          <div className="item-name-cell">
            {icon && (
              <img src={`${ICON_BASE}${icon}.png`} alt="" className="item-icon" />
            )}
            <div className="item-name-col">
              <button className="item-name-btn" onClick={(e) => { e.stopPropagation(); onItemClick(itemId); }}>
                {info.getValue()}
              </button>
              {isPlannerMode && abilities && abilities.length > 0 && (
                <div className="aa-chips">
                  {abilities.map(a => <AAChip key={a.universalId} ability={a} />)}
                </div>
              )}
            </div>
          </div>
        )
      },
    })
  ]

  if (isPlannerMode) {
    baseColumns.push(
      columnHelper.accessor('neededQty', {
        header: 'Needed',
        size: 70,
        enableColumnFilter: false,
        cell: info => <span className="qty-plain needed-qty">{info.getValue()}</span>,
      }),
      columnHelper.accessor('totalQty', {
        header: 'Have',
        size: 70,
        enableColumnFilter: false,
        cell: info => <span className="qty-plain">{info.getValue()}</span>,
      }),
      columnHelper.accessor('deficitQty', {
        header: 'Deficit',
        size: 70,
        enableColumnFilter: false,
        cell: info => {
          const v = info.getValue()
          return <span className={`qty-plain ${v > 0 ? 'deficit-qty text-red' : 'text-green'}`}>{v > 0 ? v : '✔️'}</span>
        },
      })
    )
  } else {
    baseColumns.push(
      columnHelper.accessor('totalQty', {
        header: 'Qty',
        size: 80,
        enableColumnFilter: false,
        cell: info => <span className="qty-plain">{info.getValue()}</span>,
      })
    )
  }

  return baseColumns
}

function InventoryTable({ rows, onItemClick, itemFilter, onFilteredCountChange, isPlannerMode }) {
  const [sorting, setSorting] = useState([{ id: 'totalQty', desc: true }])
  const [expanded, setExpanded] = useState({})
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 50 })

  const columns = useMemo(() => makeColumns(onItemClick, isPlannerMode), [onItemClick, isPlannerMode])

  // Reset to page 0 whenever the source rows or filter changes
  useEffect(() => {
    setPagination(p => ({ ...p, pageIndex: 0 }))
  }, [rows, itemFilter])

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
                <tr className={`main-row clickable ${row.getIsExpanded() ? 'expanded' : ''}`} onClick={() => row.toggleExpanded()}>
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
                              o.locations.reduce((acc, { loc, qty }) => { acc[loc] = (acc[loc] || 0) + qty; return acc }, {})
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
const LS_AA_PLANS_KEY = 'asc-tracker-aa-plans'

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

  // AA Planner state
  const [planningCharacter, setPlanningCharacter] = useState(null)
  const [focusedPlannerCharacter, setFocusedPlannerCharacter] = useState(null)
  const [aaPlans, setAaPlans] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_AA_PLANS_KEY)) || {} } catch { return {} }
  })

  // Item modal
  const [selectedItemId, setSelectedItemId] = useState(null)

  // Persist names to localStorage whenever the list changes
  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(characters.map(c => c.name)))
  }, [characters])

  useEffect(() => {
    localStorage.setItem(LS_AA_PLANS_KEY, JSON.stringify(aaPlans))
  }, [aaPlans])

  // On mount, fetch data for any restored characters (ref guard prevents StrictMode double-fire)
  const didFetchOnMount = useRef(false)
  useEffect(() => {
    if (didFetchOnMount.current) return
    didFetchOnMount.current = true
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
    let name = inputName.trim()
    if (!name) return
    name = name.charAt(0).toUpperCase() + name.slice(1)

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
    setItemFilter('')
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

  const handleRemoveAA = id => {
    setSelectedAAs(prev => {
      const s = new Set(prev)
      s.delete(id)
      return s
    })
  }

  const selectedAAObjects = useMemo(() => {
    return aaAbilities.filter(a => selectedAAs.has(a.universalId))
  }, [aaAbilities, selectedAAs])

  // Get currently focused planner tomes
  const computeRequiredTomes = (characterName) => {
    const plan = aaPlans[characterName] || {}
    const tomes = new Map() // 'Grade|ClassName' => total points
    Object.entries(plan).forEach(([uIdStr, classMap]) => {
      const ability = aaAbilities.find(a => a.universalId === Number(uIdStr))
      if (!ability) return
      const grade = ability.tierName
      Object.entries(classMap).forEach(([cls, pts]) => {
        if (pts <= 0) return
        const key = `${grade}|${cls}`
        tomes.set(key, (tomes.get(key) || 0) + pts)
      })
    })
    return tomes
  }

  const focusedPlannerTomes = useMemo(() => {
    if (!focusedPlannerCharacter) return null
    return computeRequiredTomes(focusedPlannerCharacter)
  }, [focusedPlannerCharacter, aaPlans, aaAbilities])

  const focusedPlannerAbilityIds = useMemo(() => {
    if (!focusedPlannerCharacter) return null
    const plan = aaPlans[focusedPlannerCharacter] || {}
    return new Set(Object.keys(plan).map(Number))
  }, [focusedPlannerCharacter, aaPlans])

  // Get planning modal tomes
  const planningModalTomes = useMemo(() => {
    if (!planningCharacter) return new Map()
    return computeRequiredTomes(planningCharacter)
  }, [planningCharacter, aaPlans, aaAbilities])

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
        row.totalQty += item.qty
        if (!row.owners.has(c.data.name)) row.owners.set(c.data.name, { owner: c.data.name, count: 0, locations: [] })
        const o = row.owners.get(c.data.name)
        o.count += item.qty
        o.locations.push({ loc: item.location, qty: item.qty })
      })
    })
    return Array.from(byItem.values()).map(row => ({
      itemName: row.itemName, icon: row.icon, itemId: row.itemId,
      totalQty: row.totalQty, owners: Array.from(row.owners.values()),
    }))
  }, [characters])

  const tableRows = useMemo(() => {
    if (focusedPlannerTomes) {
      // Planner focus mode
      return allRows.map(row => {
        if (!isTome(row.itemName)) return null
        const grade = getTomeGrade(row.itemName)
        const cls   = getTomeClass(row.itemName)
        const key   = `${grade}|${cls}`
        if (!focusedPlannerTomes.has(key)) return null
        const needed = focusedPlannerTomes.get(key)
        const abilities = aaAbilities.filter(a =>
          a.tierName === grade &&
          a.originalClassNames.includes(cls) &&
          focusedPlannerAbilityIds.has(a.universalId)
        )
        return { ...row, neededQty: needed, deficitQty: Math.max(0, needed - row.totalQty), abilities }
      }).filter(Boolean)
    }

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
  }, [allRows, tomeMode, selectedClasses, selectedGrades, requiredTomeKeys, focusedPlannerTomes, aaAbilities, focusedPlannerAbilityIds])

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
            <button className="pill-plan-btn" onClick={() => setPlanningCharacter(c.name)} title="Edit AA Plan">📝</button>
            <button className="pill-focus-btn" onClick={() => setFocusedPlannerCharacter(focusedPlannerCharacter === c.name ? null : c.name)} title={focusedPlannerCharacter === c.name ? "Turn off Planner Focus" : "Focus this Plan on main table"}>
              {focusedPlannerCharacter === c.name ? '🎯' : '⭕'}
            </button>
            <button className="pill-remove-btn" onClick={() => removeCharacter(c.name)}>×</button>
          </div>
        ))}
      </div>

      {characters.length === 0 && <div className="empty-state"><p>Enter character names above to track their inventory</p></div>}
      {characters.length > 0 && !hasData && <div className="empty-state"><p>Add a character to see their items</p></div>}

      {hasData && (
        <>
          {focusedPlannerCharacter && (
            <div className="planner-focus-banner">
              <strong>🎯 Planner Focus Active:</strong> Showing required tomes for <span>{focusedPlannerCharacter}</span>'s plan.
              <button onClick={() => setFocusedPlannerCharacter(null)}>Clear Focus</button>
            </div>
          )}

          {!focusedPlannerCharacter && (
            <FilterToolbar
              tomeMode={tomeMode}         onToggleTomeMode={handleToggleTomeMode}
              selectedClasses={selectedClasses} onToggleClass={toggleClass}
              selectedGrades={selectedGrades}   onToggleGrade={toggleGrade}
              selectedAAs={selectedAAObjects}
              onOpenAAPickeer={handleOpenAAPicker}
              onClearAAs={() => setSelectedAAs(new Set())}
              onRemoveAA={handleRemoveAA}
              aaLoading={aaLoading}
              requiredTomeKeys={requiredTomeKeys}
              itemFilter={itemFilter}
              onItemFilterChange={v => { setItemFilter(v) }}
              totalFiltered={filteredCount}
            />
          )}

          <InventoryTable
            rows={tableRows}
            onItemClick={setSelectedItemId}
            itemFilter={itemFilter}
            onFilteredCountChange={setFilteredCount}
            isPlannerMode={!!focusedPlannerCharacter}
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

      {planningCharacter && (
        <CharacterPlannerModal
          characterName={planningCharacter}
          aaPlans={aaPlans}
          setAaPlans={setAaPlans}
          aaAbilities={aaAbilities}
          aaLoading={aaLoading}
          fetchAndCacheAAs={fetchAndCacheAAs}
          aaLastSynced={aaLastSynced}
          onClose={() => setPlanningCharacter(null)}
          focusedPlannerTomes={planningModalTomes}
        />
      )}
    </div>
  )
}

export default App
