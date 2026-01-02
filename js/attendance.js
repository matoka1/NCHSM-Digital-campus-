
// attendance.js - Enhanced version with better organization and features
// *************************************************************************
// *** ATTENDANCE SYSTEM ***
// *************************************************************************

(function() {
    'use strict';
    
    // ============================
    // Configuration & Constants
    // ============================
    const CONFIG = {
        FALLBACK_LAT: -1.2921,
        FALLBACK_LON: 36.8219,
        FALLBACK_ACCURACY: 1000,
        MAX_DISTANCE_RADIUS: 50, // meters
        LOCATIONIQ_API_URL: 'https://us1.locationiq.com/v1/reverse',
        LOCATIONIQ_API_KEY: 'pk.b5a1de84afc36de2fd38643ba63d3124',
        GEOLOCATION_OPTIONS: {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0
        },
        CACHE_DURATION: {
            CLINICAL_AREAS: 5 * 60 * 1000, // 5 minutes
            COURSES: 5 * 60 * 1000, // 5 minutes
            USER_PROFILE: 10 * 60 * 1000 // 10 minutes
        }
    };
    
    // ============================
    // State Management
    // ============================
    const STATE = {
        cachedClinicalAreas: [],
        cachedCourses: [],
        userId: null,
        userProfile: null,
        isLoading: false,
        lastLoadTime: {
            clinical: 0,
            courses: 0,
            profile: 0
        },
        currentLocation: null
    };
    
    // ============================
    // DOM Elements Cache
    // ============================
    const ELEMENTS = {
        geoMessage: null,
        checkInButton: null,
        sessionTypeSelect: null,
        attendanceTargetSelect: null,
        targetLabel: null,
        historyTable: null,
        loadingIndicator: null
    };
    
    // ============================
    // Initialization
    // ============================
    function initializeAttendanceSystem() {
        console.log('📱 Initializing Enhanced Attendance System...');
        
        cacheDOMElements();
        setupEventListeners();
        setupOfflineDetection();
        injectStyles();
        
        // Auto-load if already on attendance tab
        if (isOnAttendanceTab()) {
            loadAttendanceData();
        }
        
        console.log('✅ Attendance System initialized');
    }
    
    function cacheDOMElements() {
        ELEMENTS.geoMessage = document.getElementById('geo-message');
        ELEMENTS.checkInButton = document.getElementById('check-in-button');
        ELEMENTS.sessionTypeSelect = document.getElementById('session-type');
        ELEMENTS.attendanceTargetSelect = document.getElementById('attendance-target');
        ELEMENTS.targetLabel = document.getElementById('target-label');
        ELEMENTS.historyTable = document.getElementById('geo-attendance-history');
        ELEMENTS.loadingIndicator = document.getElementById('attendance-loading');
    }
    
    function setupEventListeners() {
        // Attendance tab click
        const attendanceTab = document.querySelector('.nav a[data-tab="attendance"]');
        if (attendanceTab) {
            attendanceTab.addEventListener('click', handleAttendanceTabClick);
        }
        
        // Check-in button
        if (ELEMENTS.checkInButton) {
            ELEMENTS.checkInButton.addEventListener('click', handleCheckIn);
        }
        
        // Session type change
        if (ELEMENTS.sessionTypeSelect) {
            ELEMENTS.sessionTypeSelect.addEventListener('change', updateTargetSelect);
        }
        
        // Target select change
        if (ELEMENTS.attendanceTargetSelect) {
            ELEMENTS.attendanceTargetSelect.addEventListener('change', handleTargetSelect);
        }
        
        // Refresh button if exists
        const refreshBtn = document.getElementById('refresh-attendance');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', refreshAttendanceData);
        }
    }
    
    function setupOfflineDetection() {
        window.addEventListener('online', handleOnlineStatus);
        window.addEventListener('offline', handleOfflineStatus);
    }
    
    // ============================
    // Event Handlers
    // ============================
    async function handleAttendanceTabClick() {
        if (!STATE.isLoading) {
            await loadAttendanceData();
        }
    }
    
    async function handleCheckIn() {
        await geoCheckIn();
    }
    
    function handleTargetSelect() {
        const target = ELEMENTS.attendanceTargetSelect.value;
        if (target) {
            showMessage('✅ Target selected. Ready for check-in.', 'success');
        }
    }
    
    function handleOnlineStatus() {
        showMessage('✅ Back online - Attendance sync enabled', 'success');
        // Sync any pending check-ins
        syncPendingCheckIns();
    }
    
    function handleOfflineStatus() {
        showMessage('⚠️ Offline mode - Check-ins will be saved locally', 'warning');
    }
    
    async function refreshAttendanceData() {
        STATE.lastLoadTime.clinical = 0;
        STATE.lastLoadTime.courses = 0;
        await loadAttendanceData();
    }
    
    // ============================
    // Core Functions
    // ============================
    async function loadAttendanceData() {
        if (STATE.isLoading) return;
        
        STATE.isLoading = true;
        showLoading(true);
        showMessage('⏳ Loading attendance data...', 'info');
        
        try {
            // Load user profile
            await loadUserProfile();
            
            if (!STATE.userProfile) {
                throw new Error('Unable to load user profile. Please refresh or log in again.');
            }
            
            console.log('👤 User profile loaded:', {
                name: STATE.userProfile.full_name,
                program: STATE.userProfile.program || STATE.userProfile.department,
                block: STATE.userProfile.block
            });
            
            // Load clinical areas and courses in parallel
            await Promise.all([
                loadClinicalAreas(),
                loadCourses()
            ]);
            
            // Update UI
            updateTargetSelect();
            await loadAttendanceHistory();
            
            showMessage('✅ Attendance data loaded. Select session type and target.', 'success');
            
        } catch (error) {
            console.error("❌ Failed to load attendance data:", error);
            showMessage(`❌ Error: ${error.message}`, 'error');
        } finally {
            STATE.isLoading = false;
            showLoading(false);
        }
    }
    
    async function loadUserProfile() {
        const now = Date.now();
        const cacheValid = STATE.userProfile && 
                          (now - STATE.lastLoadTime.profile < CONFIG.CACHE_DURATION.USER_PROFILE);
        
        if (cacheValid) {
            console.log('📦 Using cached user profile');
            return;
        }
        
        console.log('👤 Loading user profile...');
        
        // Try multiple sources
        STATE.userProfile = window.db?.currentUserProfile || 
                           window.currentUserProfile || 
                           window.userProfile;
        
        STATE.userId = window.db?.currentUserId || 
                      window.currentUserId || 
                      STATE.userProfile?.user_id;
        
        const supabase = getSupabaseClient();
        
        // Fetch fresh profile if needed
        if (!STATE.userProfile && supabase) {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                STATE.userId = user.id;
                
                const { data: profile, error } = await supabase
                    .from('consolidated_user_profiles_table')
                    .select('*')
                    .eq('user_id', STATE.userId)
                    .single();
                
                if (error) throw error;
                
                STATE.userProfile = profile;
                updateGlobalProfile(profile, STATE.userId);
            }
        }
        
        STATE.lastLoadTime.profile = Date.now();
    }
    
    async function loadClinicalAreas() {
        const now = Date.now();
        const cacheValid = STATE.cachedClinicalAreas.length > 0 && 
                          (now - STATE.lastLoadTime.clinical < CONFIG.CACHE_DURATION.CLINICAL_AREAS);
        
        if (cacheValid) {
            console.log('📦 Using cached clinical areas');
            return;
        }
        
        console.log('🏥 Loading clinical areas...');
        
        if (!STATE.userProfile || (!STATE.userProfile.program && !STATE.userProfile.department)) {
            console.warn('⚠️ Missing program info for clinical areas');
            STATE.cachedClinicalAreas = [];
            return;
        }
        
        const supabase = getSupabaseClient();
        if (!supabase) {
            console.error("❌ No database connection");
            STATE.cachedClinicalAreas = [];
            return;
        }
        
        const program = STATE.userProfile?.program || STATE.userProfile?.department;
        const intakeYear = STATE.userProfile?.intake_year;
        const blockTerm = STATE.userProfile?.block || null;
        
        console.log('🎯 Clinical query:', { program, intakeYear, blockTerm });
        
        try {
            // Query clinical areas
            const { data: areaData, error: areaError } = await supabase
                .from('clinical_areas')
                .select('id, name, latitude, longitude, block, program, intake_year')
                .eq('program', program)
                .eq('intake_year', intakeYear)
                .or(blockTerm ? `block.ilike.${blockTerm},block.is.null` : 'block.is.null');
            
            if (areaError) throw areaError;
            
            // Query clinical names
            const { data: nameData, error: nameError } = await supabase
                .from('clinical_names')
                .select('id, uuid, clinical_area_name, latitude, longitude, program, intake_year, block_term')
                .eq('program', program)
                .eq('intake_year', intakeYear)
                .or(blockTerm ? `block_term.ilike.${blockTerm},block_term.is.null` : 'block_term.is.null');
            
            if (nameError) throw nameError;
            
            // Combine and deduplicate
            const mappedNames = (nameData || []).map(n => ({
                id: n.uuid,
                original_id: n.id,
                name: n.clinical_area_name,
                latitude: n.latitude,
                longitude: n.longitude,
                block: n.block_term || null,
                type: 'clinical_name'
            }));
            
            const mappedAreas = (areaData || []).map(a => ({
                ...a,
                type: 'clinical_area'
            }));
            
            STATE.cachedClinicalAreas = [...mappedAreas, ...mappedNames]
                .filter((v, i, a) => a.findIndex(t => t.name === v.name) === i)
                .sort((a, b) => a.name.localeCompare(b.name));
            
            STATE.lastLoadTime.clinical = Date.now();
            console.log(`✅ Loaded ${STATE.cachedClinicalAreas.length} clinical areas`);
            
        } catch (error) {
            console.error("❌ Error loading clinical areas:", error);
            STATE.cachedClinicalAreas = [];
            throw error;
        }
    }
    
    async function loadCourses() {
        const now = Date.now();
        const cacheValid = STATE.cachedCourses.length > 0 && 
                          (now - STATE.lastLoadTime.courses < CONFIG.CACHE_DURATION.COURSES);
        
        if (cacheValid) {
            console.log('📦 Using cached courses');
            return;
        }
        
        console.log('🏫 Loading courses...');
        
        if (!STATE.userProfile || (!STATE.userProfile.program && !STATE.userProfile.department)) {
            console.warn('⚠️ Missing program info for courses');
            STATE.cachedCourses = [];
            return;
        }
        
        const supabase = getSupabaseClient();
        if (!supabase) {
            console.error("❌ No database connection");
            STATE.cachedCourses = [];
            return;
        }
        
        const program = STATE.userProfile?.program || STATE.userProfile?.department;
        const intakeYear = STATE.userProfile?.intake_year;
        const block = STATE.userProfile?.block || null;
        
        console.log('🎯 Course query:', { program, intakeYear, block, userId: STATE.userId });
        
        try {
            // First, try to get courses via user_role_courses (for instructors)
            const { data: userRoleData, error: roleError } = await supabase
                .from('user_role_courses')
                .select(`
                    course_id,
                    courses (
                        id,
                        course_name,
                        course_code,
                        latitude,
                        longitude,
                        program,
                        intake_year,
                        block
                    )
                `)
                .eq('user_id', STATE.userId)
                .eq('courses.program', program)
                .eq('courses.intake_year', intakeYear);
            
            if (roleError && roleError.code !== 'PGRST116') { // Ignore "no rows returned" error
                console.warn('⚠️ Error fetching via user_role_courses:', roleError);
            }
            
            let courses = [];
            
            if (userRoleData && userRoleData.length > 0) {
                courses = userRoleData
                    .filter(item => item.courses)
                    .map(item => ({
                        ...item.courses,
                        via_relationship: 'user_role_courses'
                    }));
                    
                console.log(`📚 Found ${courses.length} courses via user_role_courses`);
            }
            
            // If no courses found, try direct courses table query
            if (courses.length === 0) {
                console.log('🔍 No courses via relationship, querying courses directly...');
                
                let query = supabase
                    .from('courses')
                    .select('id, course_name, course_code, latitude, longitude, program, intake_year, block')
                    .eq('program', program)
                    .eq('intake_year', intakeYear);
                
                if (block) {
                    query = query.or(`block.eq.${block},block.is.null`);
                } else {
                    query = query.is('block', null);
                }
                
                const { data: directData, error: directError } = await query.order('course_name');
                
                if (directError) throw directError;
                
                courses = (directData || []).map(course => ({
                    ...course,
                    via_relationship: 'direct'
                }));
                
                console.log(`📚 Found ${courses.length} courses via direct query`);
            }
            
            // Filter by block if specified
            if (block) {
                courses = courses.filter(course => 
                    !course.block || course.block === block
                );
            }
            
            STATE.cachedCourses = courses;
            STATE.lastLoadTime.courses = Date.now();
            
            console.log(`✅ Loaded ${STATE.cachedCourses.length} courses for user ${STATE.userId}`);
            
        } catch (error) {
            console.error("❌ Error loading courses:", error);
            STATE.cachedCourses = [];
            throw error;
        }
    }
    
    function updateTargetSelect() {
        if (!ELEMENTS.sessionTypeSelect || !ELEMENTS.attendanceTargetSelect) return;
        
        const sessionType = ELEMENTS.sessionTypeSelect.value;
        ELEMENTS.attendanceTargetSelect.innerHTML = '';
        
        let targetList = [];
        let placeholderText = 'Select a target';
        
        if (sessionType === 'Clinical') {
            targetList = STATE.cachedClinicalAreas.map(area => ({
                id: area.id,
                name: area.name,
                lat: area.latitude,
                lon: area.longitude,
                display: `${area.name}${area.block ? ` (${area.block})` : ''}`
            }));
            placeholderText = 'Select clinical area';
            
        } else if (sessionType === 'Class') {
            targetList = STATE.cachedCourses.map(course => ({
                id: course.id,
                name: course.course_name || course.name,
                code: course.course_code || course.code,
                lat: course.latitude,
                lon: course.longitude,
                display: `${course.course_code || ''}${course.course_code ? ' - ' : ''}${course.course_name || course.name}${course.block ? ` (${course.block})` : ''}`
            }));
            placeholderText = 'Select course';
        }
        
        // Update label
        if (ELEMENTS.targetLabel) {
            ELEMENTS.targetLabel.textContent = sessionType === 'Clinical' ? 'Clinical Area:' : 'Course:';
        }
        
        // Add placeholder
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = `-- ${placeholderText} --`;
        placeholder.disabled = true;
        placeholder.selected = true;
        ELEMENTS.attendanceTargetSelect.appendChild(placeholder);
        
        // Add targets
        if (targetList.length === 0) {
            const noDataOption = document.createElement('option');
            noDataOption.value = '';
            noDataOption.textContent = sessionType === 'Class' 
                ? 'No courses assigned to you' 
                : 'No clinical areas available';
            noDataOption.disabled = true;
            ELEMENTS.attendanceTargetSelect.appendChild(noDataOption);
        } else {
            targetList.forEach(target => {
                const option = document.createElement('option');
                option.value = `${target.id}|${target.name}|${target.lat}|${target.lon}`;
                option.textContent = target.display;
                option.dataset.lat = target.lat;
                option.dataset.lon = target.lon;
                ELEMENTS.attendanceTargetSelect.appendChild(option);
            });
            
            // Enable selection
            ELEMENTS.attendanceTargetSelect.disabled = false;
        }
        
        console.log(`✅ Updated ${sessionType} targets: ${targetList.length} options`);
    }
    
    async function geoCheckIn() {
        console.log('📍 Starting geo check-in...');
        
        if (!validateCheckInForm()) return;
        
        const originalButtonText = ELEMENTS.checkInButton.textContent;
        setButtonState(true, '⏳ Checking in...');
        showMessage('📍 Getting your location...', 'info');
        
        try {
            // Get location
            const location = await getCurrentLocation();
            STATE.currentLocation = location;
            
            // Parse target data
            const targetData = parseTargetData();
            if (!targetData) return;
            
            // Calculate distance and verify
            const distance = calculateDistance(
                location.lat, location.lon,
                targetData.latitude, targetData.longitude
            );
            
            const isVerified = distance <= CONFIG.MAX_DISTANCE_RADIUS;
            console.log(`📏 Distance: ${distance.toFixed(2)}m, Verified: ${isVerified}`);
            
            // Prepare check-in data
            const checkInData = prepareCheckInData(location, targetData, distance, isVerified);
            
            // Submit check-in
            await submitCheckIn(checkInData);
            
            // Success
            showCheckInSuccess(distance, isVerified);
            
            // Refresh history
            await loadAttendanceHistory();
            
            // Notify other components
            document.dispatchEvent(new CustomEvent('attendanceCheckedIn', {
                detail: checkInData
            }));
            
        } catch (error) {
            console.error('❌ Check-in error:', error);
            showMessage(`❌ ${error.message}`, 'error');
        } finally {
            setButtonState(false, originalButtonText);
        }
    }
    
    function validateCheckInForm() {
        if (!ELEMENTS.sessionTypeSelect.value) {
            showMessage('❌ Please select a session type', 'error');
            ELEMENTS.sessionTypeSelect.focus();
            return false;
        }
        
        if (!ELEMENTS.attendanceTargetSelect.value) {
            showMessage('❌ Please select a target', 'error');
            ELEMENTS.attendanceTargetSelect.focus();
            return false;
        }
        
        return true;
    }
    
    function parseTargetData() {
        const selectedValue = ELEMENTS.attendanceTargetSelect.value;
        const [id, name, lat, lon] = selectedValue.split('|');
        
        if (!id || !name || !lat || !lon) {
            throw new Error('Invalid target selection');
        }
        
        return {
            id,
            name,
            latitude: parseFloat(lat),
            longitude: parseFloat(lon)
        };
    }
    
    // ============================
    // Location Services
    // ============================
    async function getCurrentLocation() {
        console.log('📍 Requesting location...');
        
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                console.warn('⚠️ Geolocation not supported');
                resolve(getFallbackLocation());
                return;
            }
            
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const location = {
                        lat: position.coords.latitude,
                        lon: position.coords.longitude,
                        acc: position.coords.accuracy,
                        timestamp: new Date().toISOString()
                    };
                    console.log('📍 Location obtained:', location);
                    resolve(location);
                },
                (error) => {
                    console.warn('⚠️ Geolocation error:', error.message);
                    showMessage(`⚠️ Location error: ${getGeolocationError(error.code)}`, 'warning');
                    resolve(getFallbackLocation());
                },
                CONFIG.GEOLOCATION_OPTIONS
            );
        });
    }
    
    function getFallbackLocation() {
        return {
            lat: CONFIG.FALLBACK_LAT,
            lon: CONFIG.FALLBACK_LON,
            acc: CONFIG.FALLBACK_ACCURACY,
            timestamp: new Date().toISOString(),
            isFallback: true
        };
    }
    
    function getGeolocationError(code) {
        const errors = {
            1: 'Permission denied',
            2: 'Position unavailable',
            3: 'Timeout'
        };
        return errors[code] || 'Unknown error';
    }
    
    async function reverseGeocode(lat, lon) {
        try {
            const response = await fetch(
                `${CONFIG.LOCATIONIQ_API_URL}?key=${CONFIG.LOCATIONIQ_API_KEY}&lat=${lat}&lon=${lon}&format=json`
            );
            
            if (response.ok) {
                const data = await response.json();
                return data?.display_name || `Location: ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
            }
        } catch (error) {
            console.warn('⚠️ Reverse geocode failed:', error.message);
        }
        
        return `Location: ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    }
    
    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000; // Earth radius in meters
        const toRad = (deg) => deg * Math.PI / 180;
        
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const radLat1 = toRad(lat1);
        const radLat2 = toRad(lat2);
        
        const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(radLat1) * Math.cos(radLat2) *
                Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        
        return R * c;
    }
    
    // ============================
    // Database Operations
    // ============================
    function prepareCheckInData(location, target, distance, isVerified) {
        const sessionType = ELEMENTS.sessionTypeSelect.value;
        const checkInTime = new Date().toISOString();
        const deviceId = getDeviceId();
        
        return {
            p_student_id: STATE.userId,
            p_check_in_time: checkInTime,
            p_session_type: sessionType,
            p_target_id: target.id,
            p_target_name: target.name,
            p_latitude: location.lat,
            p_longitude: location.lon,
            p_accuracy_m: location.acc,
            p_location_friendly_name: location.friendlyName || `Location: ${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`,
            p_program: STATE.userProfile?.program || STATE.userProfile?.department,
            p_block: STATE.userProfile?.block,
            p_intake_year: STATE.userProfile?.intake_year,
            p_device_id: deviceId,
            p_is_verified: isVerified,
            p_course_id: sessionType === 'Class' ? target.id : null,
            p_student_name: STATE.userProfile?.full_name || STATE.userProfile?.name || 'Unknown Student',
            p_distance_meters: Math.round(distance)
        };
    }
    
    async function submitCheckIn(checkInData) {
        showMessage('📡 Submitting check-in...', 'info');
        
        const supabase = getSupabaseClient();
        if (!supabase) {
            throw new Error('No database connection available');
        }
        
        // Add friendly location name
        if (!checkInData.p_location_friendly_name.includes('Location:')) {
            checkInData.p_location_friendly_name = await reverseGeocode(
                checkInData.p_latitude,
                checkInData.p_longitude
            );
        }
        
        const { error } = await supabase
            .rpc('check_in_and_defer_fk', checkInData);
        
        if (error) {
            console.error('❌ RPC error:', error);
            
            // Try offline storage if online fails
            if (!navigator.onLine) {
                return saveCheckInOffline(checkInData);
            }
            
            throw new Error(`Check-in failed: ${error.message}`);
        }
        
        console.log('✅ Check-in submitted successfully');
    }
    
    function saveCheckInOffline(checkInData) {
        const pendingCheckIns = JSON.parse(localStorage.getItem('pending_checkins') || '[]');
        checkInData.offline_saved = new Date().toISOString();
        pendingCheckIns.push(checkInData);
        localStorage.setItem('pending_checkins', JSON.stringify(pendingCheckIns));
        
        console.log('💾 Check-in saved offline');
        showMessage('💾 Check-in saved offline. Will sync when online.', 'warning');
    }
    
    async function syncPendingCheckIns() {
        const pendingCheckIns = JSON.parse(localStorage.getItem('pending_checkins') || '[]');
        if (pendingCheckIns.length === 0) return;
        
        console.log(`📤 Syncing ${pendingCheckIns.length} pending check-ins...`);
        showMessage(`📤 Syncing ${pendingCheckIns.length} pending check-ins...`, 'info');
        
        const supabase = getSupabaseClient();
        if (!supabase) return;
        
        const successful = [];
        
        for (const checkIn of pendingCheckIns) {
            try {
                const { error } = await supabase
                    .rpc('check_in_and_defer_fk', checkIn);
                
                if (!error) {
                    successful.push(checkIn);
                }
            } catch (error) {
                console.warn('⚠️ Failed to sync check-in:', error);
            }
        }
        
        // Remove successful syncs
        const remaining = pendingCheckIns.filter(c => 
            !successful.some(s => s.offline_saved === c.offline_saved)
        );
        
        localStorage.setItem('pending_checkins', JSON.stringify(remaining));
        
        if (successful.length > 0) {
            showMessage(`✅ Synced ${successful.length} pending check-ins`, 'success');
            loadAttendanceHistory(); // Refresh history
        }
    }
    
    async function loadAttendanceHistory() {
        if (!ELEMENTS.historyTable) return;
        
        ELEMENTS.historyTable.innerHTML = `
            <tr>
                <td colspan="5" class="loading-cell">
                    <div class="loading-spinner-small"></div>
                    Loading attendance history...
                </td>
            </tr>
        `;
        
        try {
            const supabase = getSupabaseClient();
            if (!supabase) throw new Error('No database connection');
            
            const { data: logs, error } = await supabase
                .from('geo_attendance_logs')
                .select(`
                    check_in_time,
                    session_type,
                    target_name,
                    is_verified,
                    distance_meters,
                    location_friendly_name
                `)
                .eq('student_id', STATE.userId)
                .order('check_in_time', { ascending: false })
                .limit(20);
            
            if (error) throw error;
            
            renderAttendanceHistory(logs || []);
            
        } catch (error) {
            console.error('❌ Failed to load history:', error);
            ELEMENTS.historyTable.innerHTML = `
                <tr>
                    <td colspan="5" class="error-cell">
                        ❌ Error loading history: ${error.message}
                        <br>
                        <button onclick="attendanceLoadHistory()" class="attendance-btn-small">
                            Retry
                        </button>
                    </td>
                </tr>
            `;
        }
    }
    
    function renderAttendanceHistory(logs) {
        if (!ELEMENTS.historyTable) return;
        
        if (logs.length === 0) {
            ELEMENTS.historyTable.innerHTML = `
                <tr>
                    <td colspan="5" class="empty-cell">
                        No attendance records found
                    </td>
                </tr>
            `;
            return;
        }
        
        ELEMENTS.historyTable.innerHTML = logs.map(log => {
            const timeStr = new Date(log.check_in_time).toLocaleString();
            const verifiedText = log.is_verified ? '✅ Verified' : '⏳ Pending';
            const verifiedClass = log.is_verified ? 'verified' : 'pending';
            const distance = log.distance_meters ? `${log.distance_meters}m` : 'N/A';
            const location = log.location_friendly_name ? 
                `<br><small>📍 ${log.location_friendly_name.substring(0, 50)}${log.location_friendly_name.length > 50 ? '...' : ''}</small>` : '';
            
            return `
                <tr>
                    <td>${timeStr}</td>
                    <td>${log.session_type}</td>
                    <td>${log.target_name}</td>
                    <td><span class="attendance-badge ${verifiedClass}">${verifiedText}</span></td>
                    <td>${distance}${location}</td>
                </tr>
            `;
        }).join('');
    }
    
    // ============================
    // Utility Functions
    // ============================
    function getSupabaseClient() {
        return window.db?.supabase || window.supabase;
    }
    
    function getDeviceId() {
        let deviceId = localStorage.getItem('attendance_device_id');
        if (!deviceId) {
            deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            localStorage.setItem('attendance_device_id', deviceId);
        }
        return deviceId;
    }
    
    function updateGlobalProfile(profile, userId) {
        window.currentUserProfile = profile;
        window.userProfile = profile;
        window.currentUserId = userId;
        
        if (window.db) {
            window.db.currentUserProfile = profile;
            window.db.currentUserId = userId;
        }
    }
    
    function showMessage(text, type = 'info') {
        if (!ELEMENTS.geoMessage) return;
        
        ELEMENTS.geoMessage.textContent = text;
        ELEMENTS.geoMessage.className = `attendance-message attendance-${type}-message`;
        
        // Auto-clear success messages after 5 seconds
        if (type === 'success') {
            setTimeout(() => {
                if (ELEMENTS.geoMessage.textContent === text) {
                    ELEMENTS.geoMessage.textContent = '';
                    ELEMENTS.geoMessage.className = 'attendance-message';
                }
            }, 5000);
        }
    }
    
    function setButtonState(disabled, text) {
        if (!ELEMENTS.checkInButton) return;
        
        ELEMENTS.checkInButton.disabled = disabled;
        ELEMENTS.checkInButton.textContent = text;
        
        if (disabled) {
            ELEMENTS.checkInButton.classList.add('loading');
        } else {
            ELEMENTS.checkInButton.classList.remove('loading');
        }
    }
    
    function showLoading(show) {
        if (ELEMENTS.loadingIndicator) {
            ELEMENTS.loadingIndicator.style.display = show ? 'block' : 'none';
        }
    }
    
    function showCheckInSuccess(distance, isVerified) {
        const status = isVerified ? 'verified' : 'pending verification';
        const distanceText = distance < 1000 ? 
            `${distance.toFixed(0)} meters` : 
            `${(distance/1000).toFixed(1)} km`;
        
        showMessage(`
            ✅ Check-in successful!
            <br><small>Status: ${status} • Distance: ${distanceText}</small>
        `, 'success');
    }
    
    function isOnAttendanceTab() {
        const activeTab = document.querySelector('.nav a.active[data-tab="attendance"]');
        return activeTab !== null;
    }
    
    // ============================
    // CSS Injection
    // ============================
    function injectStyles() {
        const styles = document.createElement('style');
        styles.textContent = `
            .attendance-message {
                padding: 10px;
                border-radius: 6px;
                margin: 10px 0;
                font-size: 14px;
                transition: all 0.3s ease;
            }
            
            .attendance-info-message {
                background-color: #e0f2fe;
                color: #0369a1;
                border: 1px solid #bae6fd;
            }
            
            .attendance-success-message {
                background-color: #dcfce7;
                color: #166534;
                border: 1px solid #bbf7d0;
            }
            
            .attendance-error-message {
                background-color: #fee2e2;
                color: #991b1b;
                border: 1px solid #fecaca;
            }
            
            .attendance-warning-message {
                background-color: #fef3c7;
                color: #92400e;
                border: 1px solid #fde68a;
            }
            
            .attendance-badge {
                display: inline-block;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: 600;
            }
            
            .attendance-badge.verified {
                background-color: #dcfce7;
                color: #166534;
            }
            
            .attendance-badge.pending {
                background-color: #fef3c7;
                color: #92400e;
            }
            
            .loading-cell, .empty-cell, .error-cell {
                text-align: center;
                padding: 20px !important;
                color: #6b7280;
            }
            
            .loading-spinner-small {
                display: inline-block;
                width: 16px;
                height: 16px;
                border: 2px solid #e5e7eb;
                border-top-color: #3b82f6;
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin-right: 8px;
                vertical-align: middle;
            }
            
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
            
            button.loading {
                opacity: 0.7;
                cursor: not-allowed;
            }
            
            .attendance-btn-small {
                padding: 4px 12px;
                background: #3b82f6;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 13px;
                transition: background 0.2s;
            }
            
            .attendance-btn-small:hover {
                background: #2563eb;
            }
            
            #check-in-button {
                transition: all 0.3s ease;
                position: relative;
            }
            
            #check-in-button:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }
            
            .target-info {
                font-size: 12px;
                color: #6b7280;
                margin-top: 4px;
            }
        `;
        document.head.appendChild(styles);
    }
    
    // ============================
    // Public API
    // ============================
    window.attendance = {
        loadData: loadAttendanceData,
        checkIn: geoCheckIn,
        loadHistory: loadAttendanceHistory,
        updateTargets: updateTargetSelect,
        refresh: refreshAttendanceData,
        syncPending: syncPendingCheckIns,
        getState: () => ({ ...STATE }),
        getUserProfile: () => STATE.userProfile
    };
    
    // Auto-initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeAttendanceSystem);
    } else {
        initializeAttendanceSystem();
    }
    
    console.log('🚀 Enhanced Attendance System loaded');
})();
