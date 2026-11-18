// Compatibility endpoint: server push was replaced by on-device one-shot notifications.
export async function POST(){return Response.json({error:"안부 알림은 앱에서 예약합니다. 서버 예약 작업은 사용하지 않습니다."},{status:410});}
