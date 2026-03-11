#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# UCM Webhook Simulator
# Simulates UCM events for testing webhook mode
# ═══════════════════════════════════════════════════════════════════════════

set -e

# ── Configuration ────────────────────────────────────────────────────────────
MW_URL="${MW_URL:-https://ucm.selest.info}"
WEBHOOK_TOKEN="${WEBHOOK_TOKEN:-a1b2c3d4-e5f6-7890-abcd-ef1234567890}"
VERBOSE="${VERBOSE:-false}"

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ── Helper Functions ────────────────────────────────────────────────────────

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_verbose() {
    if [[ "$VERBOSE" == "true" ]]; then
        echo -e "${YELLOW}[DEBUG]${NC} $1"
    fi
}

check_curl() {
    if ! command -v curl &> /dev/null; then
        log_error "curl is required but not installed."
        echo "Please install curl: apt-get install curl (Debian/Ubuntu) or yum install curl (RHEL)"
        exit 1
    fi
}

# ── Test Functions ──────────────────────────────────────────────────────────

test_healthcheck() {
    log_info "Testing middleware healthcheck..."

    local response
    response=$(curl -s -w "\n%{http_code}" "${MW_URL}/health" 2>/dev/null)
    local http_code
    http_code=$(echo "$response" | tail -n1)
    local body
    body=$(echo "$response" | head -n-1)

    if [[ "$http_code" == "200" ]]; then
        log_success "Middleware healthcheck: HTTP 200"
        log_verbose "Response: $body"
    elif [[ "$http_code" == "503" ]]; then
        log_success "Middleware healthcheck: HTTP 503 (AMI not connected, webhook mode expected)"
        log_verbose "Response: $body"
    else
        log_error "Middleware healthcheck failed: HTTP $http_code"
        log_error "Response: $body"
        return 1
    fi
}

test_webhook_ring() {
    local token="${1:-$WEBHOOK_TOKEN}"
    local caller="${2:-0612345678}"
    local exten="${3:-1001}"
    local uniqueid="${4:-$(date +%s%N | cut -c1-16)}"
    local callerid_name="${5:-Jean+Dupont}"

    log_info "Testing RING webhook (incoming call)..."

    local url="${MW_URL}/webhook/${token}"
    local params="event=ring&caller=${caller}&exten=${exten}&uniqueid=${uniqueid}&callerid_name=${callerid_name}"

    log_verbose "URL: ${url}?${params}"

    local response
    response=$(curl -s -w "\n%{http_code}" -G "$url" --data-urlencode "event=ring" \
        --data-urlencode "caller=${caller}" \
        --data-urlencode "exten=${exten}" \
        --data-urlencode "uniqueid=${uniqueid}" \
        --data-urlencode "callerid_name=${callerid_name}" 2>/dev/null)

    local http_code
    http_code=$(echo "$response" | tail -n1)
    local body
    body=$(echo "$response" | head -n-1)

    if [[ "$http_code" == "200" ]]; then
        log_success "RING webhook: HTTP 200"
        log_verbose "Response: $body"
    elif [[ "$http_code" == "401" ]]; then
        log_error "RING webhook: HTTP 401 Unauthorized (invalid token)"
        log_error "Token: ${token}"
        log_error "Response: $body"
        return 1
    elif [[ "$http_code" == "400" ]]; then
        log_error "RING webhook: HTTP 400 Bad Request (missing or invalid event)"
        log_error "Response: $body"
        return 1
    else
        log_error "RING webhook failed: HTTP $http_code"
        log_error "Response: $body"
        return 1
    fi
}

test_webhook_answer() {
    local token="${1:-$WEBHOOK_TOKEN}"
    local caller="${2:-0612345678}"
    local exten="${3:-1001}"
    local uniqueid="${4:-$(date +%s%N | cut -c1-16)}"
    local agent="${5:-1002}"

    log_info "Testing ANSWER webhook (call answered)..."

    local url="${MW_URL}/webhook/${token}"
    local params="event=answer&caller=${caller}&exten=${exten}&uniqueid=${uniqueid}&agent=${agent}"

    log_verbose "URL: ${url}?${params}"

    local response
    response=$(curl -s -w "\n%{http_code}" -G "$url" --data-urlencode "event=answer" \
        --data-urlencode "caller=${caller}" \
        --data-urlencode "exten=${exten}" \
        --data-urlencode "uniqueid=${uniqueid}" \
        --data-urlencode "agent=${agent}" 2>/dev/null)

    local http_code
    http_code=$(echo "$response" | tail -n1)
    local body
    body=$(echo "$response" | head -n-1)

    if [[ "$http_code" == "200" ]]; then
        log_success "ANSWER webhook: HTTP 200"
        log_verbose "Response: $body"
    elif [[ "$http_code" == "401" ]]; then
        log_error "ANSWER webhook: HTTP 401 Unauthorized (invalid token)"
        return 1
    elif [[ "$http_code" == "400" ]]; then
        log_error "ANSWER webhook: HTTP 400 Bad Request (missing or invalid event)"
        return 1
    else
        log_error "ANSWER webhook failed: HTTP $http_code"
        return 1
    fi
}

test_webhook_hangup() {
    local token="${1:-$WEBHOOK_TOKEN}"
    local caller="${2:-0612345678}"
    local exten="${3:-1001}"
    local uniqueid="${4:-$(date +%s%N | cut -c1-16)}"
    local duration="${5:-45}"

    log_info "Testing HANGUP webhook (call ended)..."

    local url="${MW_URL}/webhook/${token}"
    local params="event=hangup&caller=${caller}&exten=${exten}&uniqueid=${uniqueid}&duration=${duration}"

    log_verbose "URL: ${url}?${params}"

    local response
    response=$(curl -s -w "\n%{http_code}" -G "$url" --data-urlencode "event=hangup" \
        --data-urlencode "caller=${caller}" \
        --data-urlencode "exten=${exten}" \
        --data-urlencode "uniqueid=${uniqueid}" \
        --data-urlencode "duration=${duration}" 2>/dev/null)

    local http_code
    http_code=$(echo "$response" | tail -n1)
    local body
    body=$(echo "$response" | head -n-1)

    if [[ "$http_code" == "200" ]]; then
        log_success "HANGUP webhook: HTTP 200"
        log_verbose "Response: $body"
    elif [[ "$http_code" == "401" ]]; then
        log_error "HANGUP webhook: HTTP 401 Unauthorized (invalid token)"
        return 1
    elif [[ "$http_code" == "400" ]]; then
        log_error "HANGUP webhook: HTTP 400 Bad Request (missing or invalid event)"
        return 1
    else
        log_error "HANGUP webhook failed: HTTP $http_code"
        return 1
    fi
}

# ── Complete Call Flow Test ──────────────────────────────────────────────────

test_complete_call_flow() {
    local token="${1:-$WEBHOOK_TOKEN}"
    local caller="${2:-0612345678}"
    local exten="${3:-1001}"
    local uniqueid="${4:-$(date +%s%N | cut -c1-16)}"
    local agent="${5:-1002}"
    local duration="${6:-45}"

    log_info "════════════════════════════════════════════════════════════════════════"
    log_info "Complete Call Flow Test"
    log_info "════════════════════════════════════════════════════════════════════════"
    log_info "Mock call details:"
    log_info "  Token:    ${token}"
    log_info "  Caller:   ${caller}"
    log_info "  Extension: ${exten}"
    log_info "  Agent:    ${agent}"
    log_info "  Duration: ${duration}s"
    log_info "  UniqueID: ${uniqueid}"
    log_info "════════════════════════════════════════════════════════════════════════"

    log_info ""
    log_info "Step 1/3: Simulating incoming call (RING)..."
    test_webhook_ring "$token" "$caller" "$exten" "$uniqueid" || return 1

    log_info ""
    log_info "Step 2/3: Simulating call answered (ANSWER)..."
    test_webhook_answer "$token" "$caller" "$exten" "$uniqueid" "$agent" || return 1

    log_info ""
    log_info "Step 3/3: Simulating call ended (HANGUP)..."
    test_webhook_hangup "$token" "$caller" "$exten" "$uniqueid" "$duration" || return 1

    log_info ""
    log_success "════════════════════════════════════════════════════════════════════════"
    log_success "Complete call flow test PASSED"
    log_success "════════════════════════════════════════════════════════════════════════"
    log_info ""
    log_info "Expected results:"
    log_info "  ✓ Middleware received RING event"
    log_info "  ✓ Middleware received ANSWER event"
    log_info "  ✓ Middleware received HANGUP event"
    log_info "  ✓ Agent should see popup in browser"
    log_info "  ✓ Contact should be identified from Odoo"
}

# ── Token Management Tests ───────────────────────────────────────────────────

test_unknown_token() {
    local unknown_token="00000000-0000-0000-0000-000000000000"

    log_info "Testing unknown token rejection..."
    
    local response
    response=$(curl -s -w "\n%{http_code}" -G "${MW_URL}/webhook/${unknown_token}" \
        --data-urlencode "event=ring" --data-urlencode "caller=0612345678" \
        --data-urlencode "exten=1001" --data-urlencode "uniqueid=1710000000.123" 2>/dev/null)

    local http_code
    http_code=$(echo "$response" | tail -n1)
    local body
    body=$(echo "$response" | head -n-1)

    if [[ "$http_code" == "401" ]]; then
        log_success "Unknown token rejected: HTTP 401"
        log_verbose "Response: $body"
    else
        log_error "Unknown token NOT rejected: HTTP $http_code (expected 401)"
        log_error "Response: $body"
        return 1
    fi
}

# ── Main ─────────────────────────────────────────────────────────────────────

show_usage() {
    echo "UCM Webhook Simulator"
    echo ""
    echo "Usage: $0 [command] [options]"
    echo ""
    echo "Commands:"
    echo "  health              Test middleware healthcheck"
    echo "  ring [options]      Test RING webhook"
    echo "  answer [options]    Test ANSWER webhook"
    echo "  hangup [options]    Test HANGUP webhook"
    echo "  flow [options]      Test complete call flow"
    echo "  unknown-token       Test token validation"
    echo "  all                 Run all tests"
    echo ""
    echo "Options:"
    echo "  -t, --token TOKEN   Webhook token (default: a1b2c3d4-e5f6-7890-abcd-ef1234567890)"
    echo "  -c, --caller NUM    Caller ID number (default: 0612345678)"
    echo "  -e, --exten NUM     Dialed extension (default: 1001)"
    echo "  -u, --uniqueid ID   Call unique ID (default: auto-generated)"
    echo "  -n, --name NAME     Caller name (default: Jean+Dupont)"
    echo "  -a, --agent NUM     Agent extension (default: 1002)"
    echo "  -d, --duration SEC  Call duration (default: 45)"
    echo "  -v, --verbose       Show detailed output"
    echo "  -u, --url URL       Middleware URL (default: https://ucm.selest.info)"
    echo ""
    echo "Examples:"
    echo "  $0 health"
    echo "  $0 flow -t MyUniqueToken"
    echo "  $0 ring -c 0388588621 -e 1001 -n Paul+Durand"
    echo "  MW_URL=http://localhost:3000 $0 all"
    echo ""
    echo "Environment variables:"
    echo "  MW_URL       Middleware URL"
    echo "  WEBHOOK_TOKEN Webhook token"
    echo "  VERBOSE      Enable verbose output (true|false)"
    echo ""
}

main() {
    check_curl

    local command="${1:-usage}"
    shift || true

    local token="$WEBHOOK_TOKEN"
    local caller="0612345678"
    local exten="1001"
    local uniqueid=""
    local name="Jean+Dupont"
    local agent="1002"
    local duration="45"

    # Parse options
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -t|--token)
                token="$2"
                shift 2
                ;;
            -c|--caller)
                caller="$2"
                shift 2
                ;;
            -e|--exten)
                exten="$2"
                shift 2
                ;;
            -u|--uniqueid)
                uniqueid="$2"
                shift 2
                ;;
            -n|--name)
                name="$2"
                shift 2
                ;;
            -a|--agent)
                agent="$2"
                shift 2
                ;;
            -d|--duration)
                duration="$2"
                shift 2
                ;;
            -v|--verbose)
                VERBOSE="true"
                shift
                ;;
            -u|--url)
                MW_URL="$2"
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done

    case "$command" in
        health)
            test_healthcheck
            ;;
        ring)
            uniqueid="${uniqueid:-$(date +%s%N | cut -c1-16)}"
            test_webhook_ring "$token" "$caller" "$exten" "$uniqueid" "$name"
            ;;
        answer)
            uniqueid="${uniqueid:-$(date +%s%N | cut -c1-16)}"
            test_webhook_answer "$token" "$caller" "$exten" "$uniqueid" "$agent"
            ;;
        hangup)
            uniqueid="${uniqueid:-$(date +%s%N | cut -c1-16)}"
            test_webhook_hangup "$token" "$caller" "$exten" "$uniqueid" "$duration"
            ;;
        flow)
            uniqueid="${uniqueid:-$(date +%s%N | cut -c1-16)}"
            test_complete_call_flow "$token" "$caller" "$exten" "$uniqueid" "$agent" "$duration"
            ;;
        unknown-token)
            test_unknown_token
            ;;
        all)
            log_info "Running all tests..."
            echo ""
            test_healthcheck || exit 1
            echo ""
            test_unknown_token || exit 1
            echo ""
            test_complete_call_flow "$token" "$caller" "$exten" "${uniqueid:-$(date +%s%N | cut -c1-16)}" "$agent" "$duration"
            ;;
        usage|--help|-h)
            show_usage
            ;;
        *)
            log_error "Unknown command: $command"
            echo ""
            show_usage
            exit 1
            ;;
    esac
}

main "$@"
