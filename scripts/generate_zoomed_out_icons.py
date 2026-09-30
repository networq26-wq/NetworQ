import os
from PIL import Image, ImageDraw

def create_gradient(width, height, c1=(66, 72, 232), c2=(54, 29, 216)):
    """Creates a smooth linear gradient image from top-left c1 to bottom-right c2."""
    base = Image.new("RGBA", (width, height))
    draw = ImageDraw.Draw(base)
    for y in range(height):
        for x in range(width):
            # diagonal ratio
            factor = (x / width + y / height) / 2.0
            r = int(c1[0] + (c2[0] - c1[0]) * factor)
            g = int(c1[1] + (c2[1] - c1[1]) * factor)
            b = int(c1[2] + (c2[2] - c1[2]) * factor)
            draw.point((x, y), fill=(r, g, b, 255))
    return base

def run():
    src_path = "assets/icon.png"
    im = Image.open(src_path).convert("RGBA")
    
    # 1. Detect emblem bounding box
    pixels = im.load()
    min_x, max_x, min_y, max_y = im.width, 0, im.height, 0
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = pixels[x, y]
            if r > 180 and g > 180 and b > 180:
                if x < min_x: min_x = x
                if x > max_x: max_x = x
                if y < min_y: min_y = y
                if y > max_y: max_y = y
                
    # Add a small 2px margin to ensure smooth antialiased edges
    min_x = max(0, min_x - 2)
    min_y = max(0, min_y - 2)
    max_x = min(im.width, max_x + 2)
    max_y = min(im.height, max_y + 2)
    
    emblem_crop = im.crop((min_x, min_y, max_x, max_y))
    
    # Extract white mask from emblem_crop
    # In the crop, pixels near white (255, 255, 255) are fully opaque white.
    # Pixels near background blue are transparent.
    emblem_rgba = Image.new("RGBA", emblem_crop.size, (0, 0, 0, 0))
    emblem_pixels = emblem_rgba.load()
    crop_pixels = emblem_crop.load()
    
    for y in range(emblem_crop.height):
        for x in range(emblem_crop.width):
            r, g, b, a = crop_pixels[x, y]
            # Blue background is around (60, 50, 225). White is (255, 255, 255)
            # Whiteness score:
            whiteness = min(r, g, b)
            if whiteness > 210:
                emblem_pixels[x, y] = (255, 255, 255, 255)
            elif whiteness > 100:
                alpha = int(((whiteness - 100) / 110.0) * 255)
                emblem_pixels[x, y] = (255, 255, 255, alpha)
            else:
                emblem_pixels[x, y] = (0, 0, 0, 0)
                
    # 2. Scale emblem to 44% of 1024 (approx 450px)
    # This gives the exact Ola / Uber proportion on Android home screen!
    target_emblem_size = 460
    aspect = emblem_crop.width / emblem_crop.height
    if aspect > 1:
        ew = target_emblem_size
        eh = int(target_emblem_size / aspect)
    else:
        eh = target_emblem_size
        ew = int(target_emblem_size * aspect)
        
    scaled_emblem = emblem_rgba.resize((ew, eh), Image.Resampling.LANCZOS)
    
    # 3. Create full master icon (1024x1024) with gradient background + centered 450px emblem
    master_bg = create_gradient(1024, 1024)
    pos_x = (1024 - ew) // 2
    pos_y = (1024 - eh) // 2
    
    master_icon = master_bg.copy()
    master_icon.paste(scaled_emblem, (pos_x, pos_y), scaled_emblem)
    
    # 4. Create transparent foreground for Android Adaptive Icon (1024x1024)
    fg_icon = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    fg_icon.paste(scaled_emblem, (pos_x, pos_y), scaled_emblem)
    
    # 5. Create monochrome foreground (solid white emblem on transparent)
    mono_icon = fg_icon.copy()
    
    # Save master assets
    master_icon.save("assets/icon.png", "PNG")
    master_bg.save("assets/android-icon-background.png", "PNG")
    fg_icon.save("assets/android-icon-foreground.png", "PNG")
    mono_icon.save("assets/android-icon-monochrome.png", "PNG")
    
    # Splash icon: 512x512
    splash = master_icon.resize((512, 512), Image.Resampling.LANCZOS)
    splash.save("assets/splash-icon.png", "PNG")
    
    # Favicon: 192x192
    fav = master_icon.resize((192, 192), Image.Resampling.LANCZOS)
    fav.save("assets/favicon.png", "PNG")
    fav.save("public/favicon.png", "PNG")
    fav.save("dist/favicon.png", "PNG")
    master_icon.save("public/brand_q_color.png", "PNG")
    master_icon.save("dist/brand_q_color.png", "PNG")
    
    # 6. Generate Android density mipmaps
    densities = {
        "mipmap-mdpi": (48, 108),
        "mipmap-hdpi": (72, 162),
        "mipmap-xhdpi": (96, 216),
        "mipmap-xxhdpi": (144, 324),
        "mipmap-xxxhdpi": (192, 432),
    }
    
    for folder, (icon_sz, adaptive_sz) in densities.items():
        base_dir = os.path.join("android/app/src/main/res", folder)
        os.makedirs(base_dir, exist_ok=True)
        
        # ic_launcher.png (legacy standard icon)
        legacy = master_icon.resize((icon_sz, icon_sz), Image.Resampling.LANCZOS)
        legacy.save(os.path.join(base_dir, "ic_launcher.png"), "PNG")
        
        # ic_launcher_round.png (legacy round icon)
        mask = Image.new("L", (icon_sz, icon_sz), 0)
        draw = ImageDraw.Draw(mask)
        draw.ellipse((0, 0, icon_sz - 1, icon_sz - 1), fill=255)
        round_icon = Image.new("RGBA", (icon_sz, icon_sz), (0, 0, 0, 0))
        round_icon.paste(legacy, (0, 0), mask)
        round_icon.save(os.path.join(base_dir, "ic_launcher_round.png"), "PNG")
        
        # Adaptive background & foreground (108dp sized)
        bg_adapt = master_bg.resize((adaptive_sz, adaptive_sz), Image.Resampling.LANCZOS)
        bg_adapt.save(os.path.join(base_dir, "ic_launcher_background.png"), "PNG")
        
        fg_adapt = fg_icon.resize((adaptive_sz, adaptive_sz), Image.Resampling.LANCZOS)
        fg_adapt.save(os.path.join(base_dir, "ic_launcher_foreground.png"), "PNG")
        
        mono_adapt = mono_icon.resize((adaptive_sz, adaptive_sz), Image.Resampling.LANCZOS)
        mono_adapt.save(os.path.join(base_dir, "ic_launcher_monochrome.png"), "PNG")
        
    print("Successfully generated all zoomed-out icons with golden ratio padding!")

if __name__ == "__main__":
    run()
