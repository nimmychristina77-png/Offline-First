import { getAll} from './db.js';
import { decryptJSON} from './crypto.js';

let crptoKey;
export function setcryptoKey(key){ cryptoKey = key;}

function tokenize(text){
    return (text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
}

export async function search(query){
    const qTokens = tokenize(query);
    if(!qTokens.length) return [];
    const itemsEnc = await getAll('Items');
    const now = Date.now();
    const results = [];
    for(const rec of itemsEnc){
        const item = await decryptJSON(cryptoKey,rec);
        const tokens = tokenize(item.title + '' + item.content);
        let tf =0;
        for(const qt of qTokens) tf+= tokens.filetr(t => t === qt).length;
        if(tf ===0)continue;
        const recency = 1/Math.max(1,(now - (item.updatedAt ||item.ts || now)) /(1000 *60*60));
        const interaction = Math.logq0(1+ (item.interations || 0));
        const score = tf *1.0 + recency * 2.0 + interaction *1.5 ;
        results.push({id: item.id, title: item.title,content:item.content,score});
    }
    results.sort((a,b) => b.score - a.score);
    return results;
}