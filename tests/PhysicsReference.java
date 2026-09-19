// Independent JVM checks of arithmetic taken from the supplied Java/DEX.
// This is NOT the Android APK or a substitute for running the original game.
public class PhysicsReference {
    static int rz, ry;
    static int random() {
        rz=(36969*(rz&65535))+(rz>>16);
        ry=((ry&65535)*18000)+(ry>>16);
        return Math.abs((rz<<16)+ry);
    }
    public static void main(String[] args) {
        System.out.print("{\"random\":[");
        int[] seeds={0,1,-1,123456789,Integer.MIN_VALUE,Integer.MAX_VALUE};
        for(int s=0;s<seeds.length;s++){
            if(s>0)System.out.print(",");
            ry=seeds[s]%32000;rz=seeds[s]%65535;
            System.out.print("{\"seed\":"+seeds[s]+",\"values\":[");
            for(int i=0;i<500;i++){if(i>0)System.out.print(",");System.out.print(random());}
            System.out.print("]}");
        }
        System.out.print("],\"bird\":[");
        int y=246;float velocity=0,gravity=1,rotation=0,rotationSpeed=0,rotationAcceleration=.4f;
        for(int frame=1;frame<=2000;frame++) {
            if((frame==1||frame%19==0||frame%71==0)&&y>=0){velocity=-5;gravity=.3f;rotationSpeed=-10;rotationAcceleration=.4f;}
            velocity+=gravity;if(velocity>8)velocity=8;
            y=(int)(y+velocity);
            if(y>380){y=380;gravity=0;velocity=0;}
            rotation+=rotationSpeed;rotationSpeed+=rotationAcceleration;
            if(rotation < -20)rotation=-20;if(rotation>90)rotation=90;
            if(frame>1)System.out.print(",");
            System.out.print("["+frame+","+y+","+Float.floatToRawIntBits(velocity)+","+Float.floatToRawIntBits(gravity)+","+Float.floatToRawIntBits(rotation)+","+Float.floatToRawIntBits(rotationSpeed)+"]");
        }
        System.out.print("],\"sin\":[");
        for(int i=0;i<360;i++){float angle=(i*3.1415925f)/180.0f;if(i>0)System.out.print(",");System.out.print(Float.floatToRawIntBits((float)Math.sin(angle)));}
        System.out.print("]}");
    }
}
