// check-supabase-env.js
import {createClient} from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({path: '.env.backend'})

console.log('SUPABASE_URL present?', !!process.env.SUPABASE_URL)
console.log('SUPABASE_SERVICE_ROLE_KEY present?', !!process.env.SUPABASE_SERVICE_ROLE_KEY)
console.log('SUPABASE_URL (truncated):', process.env.SUPABASE_URL ? process.env.SUPABASE_URL.replace(/(:\/\/).+(@)/, '$1***@$2') : '(missing)')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function test() {
    try {
        const {data, error} = await supabase
            .from('square_catalog_mapping')
            .select('square_id, product_id')
            .limit(1)
        if (error) {
            console.error('select error:', error)
        } else {
            console.log('select ok, sample row:', data)
        }
    } catch (err) {
        console.error('unexpected error querying table:', err)
    }
}
test()
