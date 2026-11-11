// The open tab's badge on the screen-only view: what the table has ordered so far this meal.
// Tapping it shows the tab card (every dish, the running total, and Close tab & pay).
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

export default function TabletTab({ tab, onOpen }) {
  const n = tab.rounds?.length || 0
  return (
    <button className="tablet-inventory ok tablet-tab" onClick={onOpen} title="See the tab" aria-label={`Open tab, ${n} rounds, ${rupees(tab.total)} so far`}>
      <span className="tablet-inventory-dot" aria-hidden="true" />
      <span>
        Tab{tab.table_no ? ` · ${tab.table_no}` : ''} · {rupees(tab.total)}
        <small> · {n} round{n === 1 ? '' : 's'}</small>
      </span>
    </button>
  )
}
