import UIKit
import Capacitor
import UserNotifications

@objc(DreamaryBridgeViewController)
class DreamaryBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativeSettingsPlugin())
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
        application.applicationIconBadgeNumber = 0
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

}

@objc(NativeSettingsPlugin)
class NativeSettingsPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "NativeSettingsPlugin"
    let jsName = "NativeSettings"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openAppNotificationSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getNotificationStatus", returnType: CAPPluginReturnPromise)
    ]

    @objc func openAppNotificationSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            var settingsUrl: URL?

            if #available(iOS 16.0, *) {
                settingsUrl = URL(string: UIApplication.openNotificationSettingsURLString)
            }

            if settingsUrl == nil {
                settingsUrl = URL(string: UIApplication.openSettingsURLString)
            }

            guard let url = settingsUrl else {
                call.reject("Unable to create settings URL")
                return
            }

            UIApplication.shared.open(url, options: [:]) { opened in
                call.resolve(["opened": opened])
            }
        }
    }

    @objc func getNotificationStatus(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let status: String
            let enabled: Bool

            switch settings.authorizationStatus {
            case .authorized:
                status = "granted"
                enabled = true
            case .provisional:
                status = "provisional"
                enabled = true
            case .ephemeral:
                status = "ephemeral"
                enabled = true
            case .denied:
                status = "denied"
                enabled = false
            case .notDetermined:
                status = "prompt"
                enabled = false
            @unknown default:
                status = "unknown"
                enabled = false
            }

            call.resolve([
                "supported": true,
                "enabled": enabled,
                "authorizationStatus": status
            ])
        }
    }
}
