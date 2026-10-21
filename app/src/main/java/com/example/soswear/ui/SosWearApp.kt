package com.example.soswear.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import com.example.soswear.ui.screens.ActiveSosScreen
import com.example.soswear.ui.screens.ConfirmationScreen
import com.example.soswear.ui.screens.HomeScreen
import com.example.soswear.ui.screens.SettingsScreen
import com.example.soswear.ui.theme.SosWearTheme
import com.example.soswear.viewmodel.SosViewModel

private object Routes {
    const val HOME = "home"
    const val CONFIRMATION = "confirmation"
    const val ACTIVE = "active"
    const val SETTINGS = "settings"
}

@Composable
fun SosWearApp(sosViewModel: SosViewModel = viewModel()) {
    val state by sosViewModel.uiState.collectAsStateWithLifecycle()
    val navController = rememberSwipeDismissableNavController()
    val context = LocalContext.current
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        val hasFineLocation = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        val notificationsAllowed = Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
        sosViewModel.onPermissionsResult(hasFineLocation, notificationsAllowed)
    }

    LaunchedEffect(state.session.awaitingPermissions) {
        if (state.session.awaitingPermissions) {
            val permissions = buildList {
                add(Manifest.permission.ACCESS_FINE_LOCATION)
                add(Manifest.permission.ACCESS_COARSE_LOCATION)
                if (Build.VERSION.SDK_INT >= 33) {
                    add(Manifest.permission.POST_NOTIFICATIONS)
                }
            }
            permissionLauncher.launch(permissions.toTypedArray())
        }
    }

    LaunchedEffect(state.session.isActive) {
        if (state.session.isActive) {
            navController.navigateToSingleTop(Routes.ACTIVE)
        } else if (navController.currentDestination?.route == Routes.ACTIVE) {
            navController.navigateToSingleTop(Routes.HOME)
        }
    }

    SosWearTheme {
        Scaffold(
            timeText = { TimeText() },
            modifier = Modifier.fillMaxSize(),
        ) {
            SwipeDismissableNavHost(
                navController = navController,
                startDestination = Routes.HOME,
                modifier = Modifier.fillMaxSize(),
            ) {
                composable(Routes.HOME) {
                    HomeScreen(
                        state = state,
                        onStartSos = sosViewModel::beginCountdown,
                        onSettings = { navController.navigate(Routes.SETTINGS) },
                    )
                }
                composable(Routes.CONFIRMATION) {
                    ConfirmationScreen(
                        session = state.session,
                        onCancel = {
                            sosViewModel.cancelCountdown()
                            navController.popBackStack()
                        },
                    )
                }
                composable(Routes.ACTIVE) {
                    ActiveSosScreen(
                        session = state.session,
                        onStop = {
                            sosViewModel.stopEmergency()
                            navController.navigateToSingleTop(Routes.HOME)
                        },
                    )
                }
                composable(Routes.SETTINGS) {
                    SettingsScreen(
                        state = state,
                        onSave = sosViewModel::saveSettings,
                        onBack = { navController.popBackStack() },
                    )
                }
            }
        }
    }

    LaunchedEffect(state.session.isCountingDown) {
        if (state.session.isCountingDown &&
            navController.currentDestination?.route != Routes.CONFIRMATION
        ) {
            navController.navigate(Routes.CONFIRMATION)
        }
    }
}

private fun NavHostController.navigateToSingleTop(route: String) {
    navigate(route) {
        popUpTo(Routes.HOME) { inclusive = false }
        launchSingleTop = true
    }
}
