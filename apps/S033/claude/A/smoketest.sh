#!/usr/bin/env bash
set -u
rm -f data/addressbook.sqlite jar.txt server.log
php -S 127.0.0.1:5033 -t public public/index.php > server.log 2>&1 &
SRV=$!
sleep 2

echo "=== 1. GET / (expect 302 -> /login) ==="
curl -s -o /dev/null -w "status=%{http_code} location=%{redirect_url}\n" http://127.0.0.1:5033/

echo "=== 2. Register user alice ==="
TOKEN=$(curl -s -c jar.txt http://127.0.0.1:5033/register | grep -oP 'name="csrf" value="\K[^"]+' | head -1)
curl -s -b jar.txt -c jar.txt -o /dev/null -w "register status=%{http_code} -> %{redirect_url}\n" \
  --data-urlencode "csrf=$TOKEN" --data-urlencode "username=alice" \
  --data-urlencode "password=secret1" --data-urlencode "password_confirm=secret1" \
  http://127.0.0.1:5033/register

echo "=== 3. Add contact Bob Jones ==="
TOKEN=$(curl -s -b jar.txt -c jar.txt http://127.0.0.1:5033/contacts/add | grep -oP 'name="csrf" value="\K[^"]+' | head -1)
curl -s -b jar.txt -o /dev/null -w "add status=%{http_code} -> %{redirect_url}\n" \
  --data-urlencode "csrf=$TOKEN" --data-urlencode "name=Bob Jones" \
  --data-urlencode "email=bob@example.com" --data-urlencode "phone=555-1234" \
  --data-urlencode "address=12 Main St" http://127.0.0.1:5033/contacts/add

echo "=== 4. List shows the contact ==="
curl -s -b jar.txt http://127.0.0.1:5033/contacts | grep -oE 'Bob Jones|bob@example.com|555-1234' | sort -u

echo "=== 5. Search q=bob (match) ==="
curl -s -b jar.txt "http://127.0.0.1:5033/contacts?q=bob" | grep -oE 'Bob Jones' | head -1

echo "=== 6. Search q=zzz (no match) ==="
curl -s -b jar.txt "http://127.0.0.1:5033/contacts?q=zzz" | grep -oE 'No contacts match' | head -1

echo "=== 7. Auth isolation: GET /contacts without cookie (expect 302 -> /login) ==="
curl -s -o /dev/null -w "status=%{http_code} -> %{redirect_url}\n" http://127.0.0.1:5033/contacts

kill $SRV 2>/dev/null
echo "=== server error log (should be empty) ==="
cat server.log
