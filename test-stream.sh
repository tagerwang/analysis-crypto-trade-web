#!/bin/bash

echo "测试流式输出功能..."
echo ""
echo "发送测试消息到 /api/chat..."
echo ""

curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "给我推荐马上会大涨的币",
    "stream": true
  }'

echo ""
echo ""
echo "测试完成！"
