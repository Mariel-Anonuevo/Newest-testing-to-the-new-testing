# =====================================================================
# FOMS Backend & Database Health & Integration Test Script
# =====================================================================
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "   FOMS Full Backend Health & Connectivity Verification" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$AllPassed = $true

function Report-Result($testName, $passed, $details = "") {
    if ($passed) {
        Write-Host " [PASS] $testName" -ForegroundColor Green
        if ($details) { Write-Host "        $details" -ForegroundColor Gray }
    } else {
        Write-Host " [FAIL] $testName" -ForegroundColor Red
        if ($details) { Write-Host "        $details" -ForegroundColor Yellow }
        $script:AllPassed = $false
    }
}

# ---------------------------------------------------------------------
# 1. Check Docker Containers
# ---------------------------------------------------------------------
Write-Host "1. Checking Database Services & Containers..." -ForegroundColor Yellow
$containers = @("foms-postgres", "foms-mongodb", "foms-pgadmin")

# Check MSSQL Service (Host SQLEXPRESS or Docker)
$sqlService = Get-Service -Name "MSSQL`$SQLEXPRESS" -ErrorAction SilentlyContinue
if ($sqlService -and $sqlService.Status -eq "Running") {
    Report-Result "MSSQL Host Service (SQLEXPRESS)" $true "Status: Running"
} else {
    $mssqlDocker = docker inspect -f '{{.State.Status}}' "foms-mssql" 2>$null
    if ($mssqlDocker -eq "running") {
        Report-Result "Container foms-mssql" $true "Status: running"
    } else {
        Report-Result "MSSQL Service" $false "Neither host SQLEXPRESS nor foms-mssql container is running"
    }
}

foreach ($c in $containers) {
    $status = docker inspect -f '{{.State.Status}}' $c 2>$null
    if ($status -eq "running") {
        $health = docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $c 2>$null
        Report-Result "Container $c" $true "Status: $status (health: $health)"
    } else {
        Report-Result "Container $c" $false "Not running or not found. Run 'docker compose up -d'"
    }
}

Write-Host ""
# ---------------------------------------------------------------------
# 2. Check Databases Direct Connectivity
# ---------------------------------------------------------------------
Write-Host "2. Checking Databases Connectivity & Data..." -ForegroundColor Yellow

# MSSQL Check (Host SQLEXPRESS or Docker)
try {
    $c = New-Object System.Data.SqlClient.SqlConnection("Server=localhost\SQLEXPRESS;Database=FOMS_DB;Integrated Security=True;TrustServerCertificate=True;")
    $c.Open()
    $cmd = $c.CreateCommand()
    $cmd.CommandText = "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE'"
    $count = $cmd.ExecuteScalar()
    $c.Close()
    Report-Result "MSSQL (FOMS_DB)" $true "Found $count tables in FOMS_DB (Connected to localhost\SQLEXPRESS)"
} catch {
    # Fallback to docker if host connection failed
    try {
        $mssqlCheck = docker exec -i foms-mssql /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "Postgres2026!" -d FOMS_DB -C -h -1 -W -Q "SET NOCOUNT ON; SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE';" 2>$null
        $rawMssql = ($mssqlCheck | Out-String).Trim()
        if ($rawMssql -match "(\d+)") {
            $count = [int]$matches[1]
            Report-Result "MSSQL (FOMS_DB)" $true "Found $count tables in FOMS_DB"
        } else {
            Report-Result "MSSQL (FOMS_DB)" $false "Could not count tables. Host error: $($_.Exception.Message); Docker output: $rawMssql"
        }
    } catch {
        Report-Result "MSSQL (FOMS_DB)" $false $_.Exception.Message
    }
}

# PostgreSQL Check
try {
    $pgCheck = docker exec -i foms-postgres psql -U postgres -d foms_ai_results -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>$null
    $pgCount = ($pgCheck | Out-String).Trim()
    if ($pgCount -match "^\d+$" -and [int]$pgCount -gt 0) {
        Report-Result "PostgreSQL (foms_ai_results)" $true "Found $pgCount public tables"
    } else {
        Report-Result "PostgreSQL (foms_ai_results)" $false "Could not count tables. Output: $pgCount"
    }
} catch {
    Report-Result "PostgreSQL (foms_ai_results)" $false $_.Exception.Message
}

# MongoDB Check
try {
    $mongoPass = "mongo_password_2026"
    $mongoCheck = docker exec -i foms-mongodb mongosh -u root -p $mongoPass --authenticationDatabase admin --eval "db.getSiblingDB('foms_trends_db').getCollectionNames().length" 2>$null
    $collCount = ($mongoCheck | Select-String -Pattern "^\d+$" | Select-Object -Last 1).Line.Trim()
    if ($collCount -match "^\d+$" -and [int]$collCount -gt 0) {
        Report-Result "MongoDB (foms_trends_db)" $true "Found $collCount collections"
    } else {
        # Try alternate password
        $mongoCheck2 = docker exec -i foms-mongodb mongosh -u root -p "MongoRoot2026!" --authenticationDatabase admin --eval "db.getSiblingDB('foms_trends_db').getCollectionNames().length" 2>$null
        $collCount2 = ($mongoCheck2 | Select-String -Pattern "^\d+$" | Select-Object -Last 1).Line.Trim()
        if ($collCount2 -match "^\d+$" -and [int]$collCount2 -gt 0) {
            Report-Result "MongoDB (foms_trends_db)" $true "Found $collCount2 collections"
        } else {
            Report-Result "MongoDB (foms_trends_db)" $false "Output: $mongoCheck"
        }
    }
} catch {
    Report-Result "MongoDB (foms_trends_db)" $false $_.Exception.Message
}

Write-Host ""
# ---------------------------------------------------------------------
# 3. Check FOMS.Api (ASP.NET Core on port 5007)
# ---------------------------------------------------------------------
Write-Host "3. Checking FOMS.Api (http://localhost:5007)..." -ForegroundColor Yellow

$fomsApiUp = $false
try {
    $swagger = Invoke-RestMethod -Uri "http://localhost:5007/swagger/v1/swagger.json" -Method Get -TimeoutSec 3 -ErrorAction Stop
    Report-Result "FOMS.Api Swagger Endpoint" $true "Title: $($swagger.info.title) (v$($swagger.info.version))"
    $fomsApiUp = $true
} catch {
    Report-Result "FOMS.Api Swagger Endpoint" $false "Server not responding on port 5007. Start it with: cd foms-backend/FOMS.Api; dotnet run"
}

if ($fomsApiUp) {
    # Test Login
    try {
        $loginBody = @{ username = "EMP-001"; password = "Password@123" } | ConvertTo-Json
        $loginRes = Invoke-RestMethod -Uri "http://localhost:5007/api/auth/login" -Method Post -Body $loginBody -ContentType "application/json" -TimeoutSec 5 -ErrorAction Stop
        
        if ($loginRes.success -and $loginRes.data.accessToken) {
            Report-Result "FOMS.Api Auth Login (EMP-001)" $true "Successfully logged in and received JWT token"
            $token = $loginRes.data.accessToken

            # Test Authenticated Client Query
            try {
                $clients = Invoke-RestMethod -Uri "http://localhost:5007/api/clients" -Method Get -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 5 -ErrorAction Stop
                Report-Result "FOMS.Api GET /api/clients (Secured)" $true "Retrieved $($clients.Count) clients successfully"
            } catch {
                Report-Result "FOMS.Api GET /api/clients (Secured)" $false $_.Exception.Message
            }
        } else {
            Report-Result "FOMS.Api Auth Login (EMP-001)" $false "Login failed or token missing."
        }
    } catch {
        Report-Result "FOMS.Api Auth Login (EMP-001)" $false $_.Exception.Message
    }
}

Write-Host ""
# ---------------------------------------------------------------------
# 4. Check AI Service (FastAPI Python on port 8000)
# ---------------------------------------------------------------------
Write-Host "4. Checking AI Service (http://localhost:8000)..." -ForegroundColor Yellow

try {
    $aiHealth = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health/ready" -Method Get -TimeoutSec 3 -ErrorAction Stop
    if ($aiHealth.status -eq "READY") {
        Report-Result "AI Service /health/ready" $true "Status: READY (Postgres: $($aiHealth.postgres), Mongo: $($aiHealth.mongodb))"
    } else {
        Report-Result "AI Service /health/ready" $false "Service status is: $($aiHealth.status)"
    }
} catch {
    Report-Result "AI Service /health/ready" $false "Server not responding on port 8000. Start it with: cd ai-service; py -m uvicorn app.main:app --reload"
}

Write-Host ""
# ---------------------------------------------------------------------
# 5. Unit Tests Check
# ---------------------------------------------------------------------
Write-Host "5. Unit Tests Summary..." -ForegroundColor Yellow
Write-Host "   To run all 49 backend unit tests, run:" -ForegroundColor Gray
Write-Host "   dotnet test ./foms-backend/FOMS.Tests/FOMS.Tests.csproj" -ForegroundColor White

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
if ($AllPassed) {
    Write-Host "   ALL RUNNING SERVICES & DATABASES ARE 100% OPERATIONAL!" -ForegroundColor Green
} else {
    Write-Host "   SOME SERVICES ARE NOT RUNNING YET (Check logs above)" -ForegroundColor Yellow
}
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
