# Check if API is running and accessible

Write-Host "=== Checking Parcel Yatra API ===" -ForegroundColor Cyan
Write-Host ""

# Check if port 3000 is in use
Write-Host "1. Checking if API port 3000 is in use..." -ForegroundColor Yellow
$port3000 = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue

if ($port3000) {
    Write-Host "✅ Port 3000 is in use" -ForegroundColor Green
    Write-Host "   Process: $($port3000.OwningProcess)" -ForegroundColor Gray
} else {
    Write-Host "❌ Port 3000 is NOT in use - API is not running!" -ForegroundColor Red
    Write-Host ""
    Write-Host "To start the API, run:" -ForegroundColor Yellow
    Write-Host "  npm run dev:api" -ForegroundColor White
    Write-Host ""
    Write-Host "Or start both API and Web together:" -ForegroundColor Yellow
    Write-Host "  npm run dev" -ForegroundColor White
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "2. Testing API health endpoint..." -ForegroundColor Yellow

try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:3000/v1/health" -UseBasicParsing -TimeoutSec 5
    
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ API is responding!" -ForegroundColor Green
        Write-Host "   Response: $($response.Content)" -ForegroundColor Gray
    } else {
        Write-Host "⚠️  API responded with status: $($response.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ Cannot reach API health endpoint" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "1. Check if API is running: npm run dev:api" -ForegroundColor White
    Write-Host "2. Check .env file has correct DATABASE_URL" -ForegroundColor White
    Write-Host "3. Check API logs in api.log and api.err.log" -ForegroundColor White
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "3. Testing API root endpoint..." -ForegroundColor Yellow

try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:3000/" -UseBasicParsing -TimeoutSec 5
    
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ API root is responding!" -ForegroundColor Green
        $json = $response.Content | ConvertFrom-Json
        Write-Host "   Name: $($json.name)" -ForegroundColor Gray
        Write-Host "   Version: $($json.version)" -ForegroundColor Gray
        Write-Host "   Status: $($json.status)" -ForegroundColor Gray
    }
} catch {
    Write-Host "⚠️  API root endpoint issue: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "4. Checking web server (port 5173)..." -ForegroundColor Yellow
$port5173 = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue

if ($port5173) {
    Write-Host "✅ Web server is running on port 5173" -ForegroundColor Green
} else {
    Write-Host "⚠️  Web server is NOT running" -ForegroundColor Yellow
    Write-Host "   To start: npm run dev:web" -ForegroundColor White
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "If you see errors above:" -ForegroundColor Yellow
Write-Host ""
Write-Host "Option 1: Start both services together (recommended)" -ForegroundColor Cyan
Write-Host "  npm run dev" -ForegroundColor White
Write-Host ""
Write-Host "Option 2: Start separately (for debugging)" -ForegroundColor Cyan
Write-Host "  Terminal 1: npm run dev:api" -ForegroundColor White
Write-Host "  Terminal 2: npm run dev:web" -ForegroundColor White
Write-Host ""
Write-Host "Then visit: http://localhost:5173" -ForegroundColor Green
Write-Host ""
