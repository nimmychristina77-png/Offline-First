const db_name = 'offlineFirstApp';
const db_ver =1;
let dbPromise;
export function openDB(){
    if(!dbPromise){
        dbPromise = new Promise((resolve, reject) => {
            const req= indexedDB.open(db_name,db_ver);
            req.onupgradeneeded = () => {
                const db = req.result;
                if(! db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath:'id'});
                if(!)
            }
        })
    }
}