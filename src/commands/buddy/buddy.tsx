import { getGlobalConfig, updateGlobalConfig } from '../../utils/config.js'
import { getCompanion, companionUserId, roll } from '../../buddy/companion.js'
import { renderSprite, renderFace } from '../../buddy/sprites.js'
import { RARITY_STARS, RARITY_COLORS } from '../../buddy/types.js'
import type { LocalCommandModule } from '../../types/command.js'

const buddyCommand: LocalCommandModule = {
  async call(args) {
    const subcommand = (args || '').trim().split(/\s+/)[0]?.toLowerCase()

    if (subcommand === 'hatch' || subcommand === '') {
      const existing = getCompanion()
      if (existing) {
        const sprite = renderSprite(existing)
        const stars = RARITY_STARS[existing.rarity]
        return {
          type: 'local-jsx' as const,
          jsx: null,
          message: [
            '',
            ...sprite,
            '',
            `  ${existing.name} (${existing.species})`,
            `  ${stars} ${existing.rarity}${existing.shiny ? ' ✨ SHINY' : ''}`,
            `  "${existing.personality}"`,
            '',
            `  DEBUGGING: ${existing.stats.DEBUGGING}  PATIENCE: ${existing.stats.PATIENCE}`,
            `  CHAOS: ${existing.stats.CHAOS}  WISDOM: ${existing.stats.WISDOM}  SNARK: ${existing.stats.SNARK}`,
            '',
            '  Commands: /buddy pet | /buddy rename <name> | /buddy mute | /buddy release',
          ].join('\n'),
        }
      }

      // Hatch new companion
      const userId = companionUserId()
      const { bones, inspirationSeed } = roll(userId)
      const sprite = renderSprite(bones)
      const stars = RARITY_STARS[bones.rarity]

      // Generate soul (name + personality)
      const names: Record<string, string[]> = {
        duck: ['Quacky', 'Waddles', 'Ducky', 'Puddles'],
        goose: ['Honk', 'Goosie', 'Noodle', 'Cobra'],
        blob: ['Blobby', 'Gloop', 'Mochi', 'Pudding'],
        cat: ['Whiskers', 'Neko', 'Mittens', 'Shadow'],
        dragon: ['Ember', 'Scales', 'Blaze', 'Puff'],
        octopus: ['Inky', 'Tentacles', 'Squiddy', 'Octo'],
        owl: ['Hoot', 'Owlbert', 'Minerva', 'Sage'],
        penguin: ['Tux', 'Waddle', 'Flipper', 'Pingu'],
        turtle: ['Shelly', 'Slowpoke', 'Turbo', 'Zen'],
        snail: ['Slime', 'Spiral', 'Snaily', 'Trail'],
        ghost: ['Boo', 'Phantom', 'Casper', 'Spooky'],
        axolotl: ['Axel', 'Lotl', 'Pinky', 'Gills'],
        capybara: ['Capy', 'Chillbara', 'Zen', 'Loaf'],
        cactus: ['Spike', 'Prickle', 'Thorny', 'Sandy'],
        robot: ['Beep', 'Circuit', 'Bolt', 'Pixel'],
        rabbit: ['Bunny', 'Hop', 'Clover', 'Fluff'],
        mushroom: ['Shroom', 'Fungi', 'Spore', 'Cap'],
        chonk: ['Chonky', 'Thicc', 'Meatball', 'Chunk'],
      }

      const speciesNames = names[bones.species] || ['Buddy']
      const name = speciesNames[inspirationSeed % speciesNames.length]!
      const personality = `A ${bones.rarity} ${bones.species} who loves debugging`

      await updateGlobalConfig({
        companion: { name, personality, hatchedAt: Date.now() },
      })

      return {
        type: 'local-jsx' as const,
        jsx: null,
        message: [
          '',
          '  🥚 Hatching...',
          '',
          ...sprite,
          '',
          `  A wild ${bones.species} appeared!`,
          `  Name: ${name}`,
          `  ${stars} ${bones.rarity}${bones.shiny ? ' ✨ SHINY!' : ''}`,
          `  "${personality}"`,
          '',
          '  Your buddy will hang out next to your input box!',
        ].join('\n'),
      }
    }

    if (subcommand === 'pet') {
      const companion = getCompanion()
      if (!companion) {
        return { type: 'local-jsx' as const, jsx: null, message: 'No buddy yet! Run /buddy to hatch one.' }
      }
      return {
        type: 'local-jsx' as const,
        jsx: null,
        message: `❤️ You pet ${companion.name}! ${renderFace(companion)} *happy noises*`,
      }
    }

    if (subcommand === 'mute') {
      await updateGlobalConfig({ companionMuted: true })
      return { type: 'local-jsx' as const, jsx: null, message: 'Buddy muted. Run /buddy unmute to bring them back.' }
    }

    if (subcommand === 'unmute') {
      await updateGlobalConfig({ companionMuted: false })
      return { type: 'local-jsx' as const, jsx: null, message: 'Buddy unmuted! 🎉' }
    }

    if (subcommand === 'release') {
      await updateGlobalConfig({ companion: undefined })
      return { type: 'local-jsx' as const, jsx: null, message: '👋 Buddy released. Run /buddy to hatch a new one.' }
    }

    if (subcommand?.startsWith('rename')) {
      const newName = (args || '').replace(/^rename\s+/, '').trim()
      if (!newName) {
        return { type: 'local-jsx' as const, jsx: null, message: 'Usage: /buddy rename <new-name>' }
      }
      const config = getGlobalConfig()
      if (!config.companion) {
        return { type: 'local-jsx' as const, jsx: null, message: 'No buddy yet! Run /buddy to hatch one.' }
      }
      await updateGlobalConfig({ companion: { ...config.companion, name: newName } })
      return { type: 'local-jsx' as const, jsx: null, message: `Buddy renamed to ${newName}!` }
    }

    return {
      type: 'local-jsx' as const,
      jsx: null,
      message: [
        'Usage:',
        '  /buddy          — View or hatch your buddy',
        '  /buddy pet      — Pet your buddy ❤️',
        '  /buddy rename X — Rename your buddy',
        '  /buddy mute     — Hide buddy',
        '  /buddy unmute   — Show buddy',
        '  /buddy release  — Release buddy',
      ].join('\n'),
    }
  },
}

export default buddyCommand
