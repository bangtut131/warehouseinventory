import { accurateClient } from './src/lib/accurate';

async function main() {
  try {
     const res = await accurateClient.get('/delivery-order/list.do', {
         params: { 
             fields: 'id,number,transDate,detailItem.salesOrder.number,customerName',
             'sp.pageSize': 5
         }
     });
     console.dir(res.data, { depth: 5 });
  } catch(e: any) {
     console.error(e.message);
  }
}
main();
