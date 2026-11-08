import { Design } from '@valenced/discord/design'
import { Stores, onFluxEventDispatched } from '@valenced/discord/flux'
import { BundleUpdaterManager } from '@valenced/discord/native'
import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { after, instead } from '@valenced/patcher'

interface Settings {
    aliases: Record<string, string> // server or channel ID -> your name
    draftId: string
    draftName: string
}

const DEFAULTS: Settings = { aliases: {}, draftId: '', draftName: '' }

const rename = (obj: any, aliases: Record<string, string>) => {
    const alias = obj?.id && aliases[obj.id]
    if (!alias || obj.name === alias) return
    try {
        obj.name = alias
    } catch {
        // frozen object: skipped
    }
}

function renameGuild(guild: any, aliases: Record<string, string>) {
    if (!guild) return
    rename(guild, aliases)
    guild.channels?.forEach?.((c: any) => rename(c, aliases))
    guild.threads?.forEach?.((c: any) => rename(c, aliases))
}

// Finds the channel row element in a rendered channel-list item.
function findRow(node: any, depth = 0): any {
    if (!node || typeof node !== 'object' || depth > 8) return null
    if (node.props?.channel && node.type) return node
    const kids = node.props?.children
    for (const k of Array.isArray(kids) ? kids : [kids]) {
        const found = findRow(k, depth + 1)
        if (found) return found
    }
    return null
}

// Copy of a channel with a new name that keeps its prototype (methods like isThread()).
const withName = (channel: any, name: string) =>
    Object.assign(Object.create(Object.getPrototypeOf(channel)), channel, { name })

export default plugin<{ jsonStorage: Settings }>({
    jsonStorage: { load: true, default: DEFAULTS },
    start({ cleanup, jsonStorage, logger }) {
        const aliases = () => jsonStorage.cache?.aliases ?? {}

        // Names already in Discord's stores.
        try {
            const { GuildStore, ChannelStore } = Stores as any
            for (const id of Object.keys(aliases())) {
                rename(GuildStore?.getGuild?.(id), aliases())
                rename(ChannelStore?.getChannel?.(id), aliases())
            }
        } catch (e) {
            logger.log(`Local Renamer: store pass failed: ${e}`)
        }

        // Names that arrive later (login, joining, channel edits).
        cleanup(
            onFluxEventDispatched('CONNECTION_OPEN', (p: any) => (p?.guilds?.forEach((g: any) => renameGuild(g, aliases())), p)),
            onFluxEventDispatched('GUILD_CREATE', (p: any) => (renameGuild(p?.guild ?? p, aliases()), p)),
            onFluxEventDispatched('GUILD_UPDATE', (p: any) => (rename(p?.guild, aliases()), p)),
            onFluxEventDispatched('CHANNEL_CREATE', (p: any) => (rename(p?.channel, aliases()), p)),
            onFluxEventDispatched('CHANNEL_UPDATE', (p: any) => (rename(p?.channel, aliases()), p)),
            onFluxEventDispatched('CHANNEL_UPDATES', (p: any) => (p?.channels?.forEach((c: any) => rename(c, aliases())), p)),
        )
        // Second path, same technique the Dashless plugin uses for the channel list:
        // swap the `channel` prop on each row at render time. Works even if the
        // store objects above can't be edited.
        cleanup(
            getModules(withProps('renderChannelListItem'), (Item: any) => {
                let patched = false
                cleanup(
                    after(Item, 'renderChannelListItem', (_args: any, tree: any) => {
                        try {
                            const memo = !patched && findRow(tree)?.type
                            if (memo && typeof memo.type === 'function') {
                                patched = true
                                cleanup(
                                    instead(memo, 'type', ([props, ...rest]: any[], orig: any) => {
                                        const alias = props?.channel && aliases()[props.channel.id]
                                        const next = alias ? { ...props, channel: withName(props.channel, alias) } : props
                                        return orig(next, ...rest)
                                    }),
                                )
                            }
                        } catch (e) {
                            logger.log(`Local Renamer: row patch failed: ${e}`)
                        }
                        return tree
                    }),
                )
            }),
        )
        logger.log('Local Renamer started')
    },
    SettingsComponent({ api }) {
        const { TableRowGroup, TableRow, TextInput, Button } = Design
        const s = { ...DEFAULTS, ...api.jsonStorage.use() }
        const set = (patch: Partial<Settings>) => api.jsonStorage.set({ ...s, ...patch })

        const save = () => {
            const id = s.draftId.trim()
            const name = s.draftName.trim()
            if (!id || !name) return
            set({ aliases: { ...s.aliases, [id]: name }, draftId: '', draftName: '' })
        }
        const remove = (id: string) => {
            const { [id]: _gone, ...rest } = s.aliases
            set({ aliases: rest })
        }

        return (
            <>
                <TableRowGroup title="Rename">
                    <TextInput
                        label="Server or channel ID"
                        placeholder="Copy the ID with Developer Mode on"
                        value={s.draftId}
                        onChange={(draftId: string) => set({ draftId })}
                    />
                    <TextInput
                        label="Your name for it"
                        value={s.draftName}
                        onChange={(draftName: string) => set({ draftName })}
                    />
                    <Button text="Save name" onPress={save} />
                </TableRowGroup>
                <TableRowGroup title="Your names (tap to remove)">
                    {Object.entries(s.aliases).map(([id, name]) => (
                        <TableRow key={id} label={name} subLabel={id} onPress={() => remove(id)} />
                    ))}
                </TableRowGroup>
                <TableRowGroup>
                    <Button text="Reload to apply changes" onPress={() => BundleUpdaterManager.reload()} />
                </TableRowGroup>
            </>
        )
    },
})
