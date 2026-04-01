import type { Command } from '../../commands.js'

const buddy = {
  type: 'local',
  name: 'buddy',
  description: 'Hatch & manage your coding companion 🥚',
  isHidden: false,
  supportsNonInteractive: false,
  load: () => import('./buddy.js'),
} satisfies Command

export default buddy
