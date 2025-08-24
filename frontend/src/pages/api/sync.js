// Example with Express or Next.js API route (Node.js)

import { spawn } from 'child_process'

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed')

    try {
        // Spawn a child process to run your sync script (adjust path as needed)
        const syncProcess = spawn('node', ['path/to/syncToSupabase.js'])

        syncProcess.stdout.on('data', (data) => {
            console.log(`Sync stdout: ${data}`)
        })

        syncProcess.stderr.on('data', (data) => {
            console.error(`Sync stderr: ${data}`)
        })

        syncProcess.on('close', (code) => {
            if (code === 0) {
                res.status(200).json({ message: 'Sync completed' })
            } else {
                res.status(500).json({ message: `Sync process exited with code ${code}` })
            }
        })
    } catch (err) {
        console.error('Sync error:', err)
        res.status(500).json({ message: 'Sync error' })
    }
}
