import { accurateClient } from './src/lib/accurate';

async function main() {
  try {
     const soSearch = await accurateClient.get('/sales-order/list.do', {
         params: { 'filter.number.op': 'EQUAL', 'filter.number.val': 'SO.2026.04.01378' }
     });
     if (soSearch.data?.d?.[0]) {
         const id = soSearch.data.d[0].id;
         const soDetail = await accurateClient.get('/sales-order/detail.do', { params: { id } });
         console.dir(soDetail.data.d, { depth: 5 });
     } else {
         console.log('SO not found');
     }
  } catch(e: any) {
     console.error(e.message);
  }
}
main();
