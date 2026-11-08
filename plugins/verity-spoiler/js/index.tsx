import { Design } from '@valenced/discord/design'
import { Stores, onFluxEventDispatched } from '@valenced/discord/flux'

interface Settings {
    enabled: boolean
    wholeMessage: boolean
}

const DEFAULTS: Settings = { enabled: true, wholeMessage: false }

// Never touched: code blocks, inline code, existing spoilers, links, <@mentions>/<:emoji:1>/<#channels>.
const PROTECTED = /```[\s\S]*?```|`[^`\n]*`|\|\|[\s\S]*?\|\||https?:\/\/\S+|<[^>\s]+>/g
const WORD = /\bverity\b/gi

const wrap = (text: string) => text.replace(WORD, '||$&||')

function spoilerizeWord(content: string) {
    const re = new RegExp(PROTECTED.source, 'g')
    let out = ''
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
        out += wrap(content.slice(last, m.index)) + m[0]
        last = m.index + m[0].length
    }
    return out + wrap(content.slice(last))
}

function patchMessage(message: any, wholeMessage: boolean) {
    if (!message || typeof message.content !== 'string' || !message.content) return

    // Only other people's messages.
    const me = (Stores as any).UserStore?.getCurrentUser?.()?.id
    if (me && message.author?.id === me) return

    const wordMode = spoilerizeWord(message.content)
    if (wordMode === message.content) return // "verity" not mentioned

    // Whole-message mode can't nest inside existing spoilers, so those fall back to word mode.
    message.content =
        wholeMessage && !message.content.includes('||') ? `||${message.content}||` : wordMode
}

export default plugin<{ jsonStorage: Settings }>({
    jsonStorage: { load: true, default: DEFAULTS },
    start({ cleanup, jsonStorage, logger }) {
        const cfg = () => ({ ...DEFAULTS, ...jsonStorage.cache })
        const handle = (message: any) => {
            const c = cfg()
            if (c.enabled) patchMessage(message, c.wholeMessage)
        }

        // Client-side only: rewrites message content as messages arrive or load.
        cleanup(
            onFluxEventDispatched('MESSAGE_CREATE', (p: any) => (handle(p?.message), p)),
            onFluxEventDispatched('MESSAGE_UPDATE', (p: any) => (handle(p?.message), p)),
            onFluxEventDispatched('LOAD_MESSAGES_SUCCESS', (p: any) => (p?.messages?.forEach(handle), p)),
            onFluxEventDispatched('LOAD_MESSAGES_AROUND_SUCCESS', (p: any) => (p?.messages?.forEach(handle), p)),
        )
        logger.log('Verity Spoiler started')
    },
    SettingsComponent({ api }) {
        const { TableRowGroup, TableSwitchRow } = Design
        const s = { ...DEFAULTS, ...api.jsonStorage.use() }

        return (
            <TableRowGroup>
                <TableSwitchRow
                    label="Spoiler “verity”"
                    subLabel="Other people’s messages only. Reload to refresh cached messages."
                    value={s.enabled}
                    onValueChange={(enabled: boolean) => api.jsonStorage.set({ ...s, enabled })}
                />
                <TableSwitchRow
                    label="Spoiler the whole message"
                    subLabel="Off: only the word is hidden behind a black box."
                    value={s.wholeMessage}
                    onValueChange={(wholeMessage: boolean) => api.jsonStorage.set({ ...s, wholeMessage })}
                />
            </TableRowGroup>
        )
    },
})
